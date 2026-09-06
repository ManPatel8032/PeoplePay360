/**
 * Segregation-of-duties guards.
 *
 * Two rules sit above the ordinary role matrix, because in both cases the
 * person who would normally hold the permission has a conflict of interest:
 *
 *  1. A manager's own attendance may only be reviewed, corrected, approved or
 *     rejected by an Admin — not by a peer manager or by HR.
 *  2. The pay of payroll staff (the people who run payroll) may only be set by
 *     an Admin, so nobody can influence their own or a colleague's salary.
 */
import { one } from '../db.js';
import { scope } from '../auth.js';

/** Roles whose holders are considered payroll staff for rule 2. */
export const PAYROLL_ROLES = ['payroll_user', 'payroll_manager'];

export const isAdmin = (req) => req.user?.role === 'admin';

/**
 * Which employee records may this caller see, for a given module?
 *
 *   { scope: 'all' }                 sees every record
 *   { scope: 'self', ids: [ownId] }  sees only their own
 *   { scope: 'none', ids: [] }       sees nothing
 *
 * Visibility comes from the ROLE in `auth.js`, never from the org chart.
 * Leading a team is a position, not a permission: the PS gives Employee
 * "view own employee details ... no HR administration access", so a manager
 * on the employee role still sees only themselves.
 */
export function visibleEmployees(req, module = 'employees', action = 'read') {
  const allowed = scope(req, module, action);
  if (allowed === 'all') return { scope: 'all', ids: null };

  const selfId = req.user?.employee_id ?? null;
  if (allowed === 'none' || !selfId) return { scope: 'none', ids: [] };
  return { scope: 'self', ids: [selfId] };
}

/**
 * True when the caller may touch this particular employee's records.
 * `action` picks which column of the matrix decides it: reading someone
 * else's leave and booking it for them are different permissions.
 */
export function canSeeEmployee(req, employeeId, module = 'employees', action = 'read') {
  const v = visibleEmployees(req, module, action);
  if (v.scope === 'all') return true;
  return v.ids.includes(Number(employeeId));
}

/**
 * SQL fragment restricting a query to the visible employees.
 * Returns null when no restriction is needed.
 */
export function employeeScopeFilter(req, column, params, module = 'employees', action = 'read') {
  const v = visibleEmployees(req, module, action);
  if (v.scope === 'all') return null;
  if (!v.ids.length) return `${column} IS NULL`; // matches nothing
  params.push(v.ids);
  return `${column} = ANY($${params.length}::int[])`;
}

/** True when this employee has at least one direct report. */
export async function isManager(employeeId) {
  if (!employeeId) return false;
  const row = await one(
    'SELECT EXISTS (SELECT 1 FROM employees WHERE manager_id = $1) AS yes',
    [employeeId]
  );
  return !!row?.yes;
}

/** True when this employee holds a payroll user account. */
export async function isPayrollStaff(employeeId) {
  if (!employeeId) return false;
  const row = await one(
    `SELECT EXISTS (
       SELECT 1 FROM users
        WHERE employee_id = $1 AND role = ANY($2::text[])
     ) AS yes`,
    [employeeId, PAYROLL_ROLES]
  );
  return !!row?.yes;
}

/**
 * Rule 1 — a manager's attendance record is admin-only territory.
 * Returns an error object to send, or null when the caller may proceed.
 */
export async function blockManagerAttendance(req, employeeId) {
  if (isAdmin(req)) return null;
  if (!(await isManager(employeeId))) return null;

  const emp = await one('SELECT name FROM employees WHERE id = $1', [employeeId]);
  return {
    status: 403,
    body: {
      error: `${emp?.name || 'This employee'} manages other staff — only an Admin can review or correct their attendance.`,
      rule: 'manager_attendance_admin_only',
    },
  };
}

/**
 * Rule 2 — only an Admin may set the pay terms of payroll staff.
 * `changes` lets an ordinary edit through when it does not touch pay.
 */
export async function blockPayrollStaffPay(req, employeeId, changes = null) {
  if (isAdmin(req)) return null;
  if (!(await isPayrollStaff(employeeId))) return null;

  // On an update, only guard the fields that actually decide the money.
  if (changes) {
    const PAY_FIELDS = ['wage', 'structure_id'];
    const touchesPay = PAY_FIELDS.some((f) => changes[f] !== undefined);
    if (!touchesPay) return null;
  }

  const emp = await one('SELECT name FROM employees WHERE id = $1', [employeeId]);
  return {
    status: 403,
    body: {
      error: `${emp?.name || 'This employee'} is payroll staff — only an Admin can decide their wage or salary structure.`,
      rule: 'payroll_staff_pay_admin_only',
    },
  };
}

/** Send a guard result. Returns true when the request was rejected. */
export function rejected(res, guard) {
  if (!guard) return false;
  res.status(guard.status).json(guard.body);
  return true;
}

export const ROLE_HIERARCHY = {
  employee: 1,
  hr_manager: 2,
  payroll_user: 3,
  payroll_manager: 4,
  admin: 5,
};

/**
 * Rule 3 — Hierarchy & Self-Payroll restriction.
 * An employee (even if payroll_user or payroll_manager) cannot create or run their own payroll.
 * Their payroll must be processed by an Admin (or strictly higher in hierarchy:
 * employee -> hr -> payroll_user -> payroll_manager -> admin).
 */
export async function blockPayrollCreation(req, targetEmployeeId) {
  if (isAdmin(req)) return null;

  const callerEmpId = req.user?.employee_id;
  const callerRole = req.user?.role || 'employee';
  const callerRank = ROLE_HIERARCHY[callerRole] || 1;

  // 1. Self-payroll restriction
  if (callerEmpId && Number(targetEmployeeId) === Number(callerEmpId)) {
    return {
      status: 403,
      body: {
        error: 'You cannot create or process your own payroll. Your payroll must be processed by an Admin.',
        rule: 'self_payroll_forbidden',
      },
    };
  }

  // 2. Hierarchy check
  const targetUser = await one(
    'SELECT role FROM users WHERE employee_id = $1 AND is_active = TRUE ORDER BY id LIMIT 1',
    [targetEmployeeId]
  );
  const targetRole = targetUser?.role || 'employee';
  const targetRank = ROLE_HIERARCHY[targetRole] || 1;

  if (targetRank >= callerRank) {
    const emp = await one('SELECT name FROM employees WHERE id = $1', [targetEmployeeId]);
    const empName = emp?.name || 'This employee';
    if (targetRole === 'payroll_manager') {
      return {
        status: 403,
        body: {
          error: `${empName} is a Payroll Manager. Their payroll must be processed by an Admin.`,
          rule: 'payroll_hierarchy_restriction',
        },
      };
    }
    if (targetRole === 'payroll_user') {
      return {
        status: 403,
        body: {
          error: `${empName} is a Payroll User. Their payroll must be processed by a Payroll Manager or Admin.`,
          rule: 'payroll_hierarchy_restriction',
        },
      };
    }
    return {
      status: 403,
      body: {
        error: `You cannot process payroll for ${empName} (${targetRole.replace('_', ' ')}). It must be processed by a higher authority or Admin.`,
        rule: 'payroll_hierarchy_restriction',
      },
    };
  }

  return null;
}
