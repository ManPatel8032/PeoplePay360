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
import { one, query } from '../db.js';

/** Roles whose holders are considered payroll staff for rule 2. */
export const PAYROLL_ROLES = ['payroll_user', 'payroll_manager'];

export const isAdmin = (req) => req.user?.role === 'admin';

/**
 * Which employee records may this caller see?
 *
 *   { scope: 'all' }                    admin, hr_manager, payroll_*
 *   { scope: 'team', ids: [...] }       anyone with direct reports — their own
 *                                       record plus their whole subtree, so a
 *                                       department head still sees the people
 *                                       under their team leads
 *   { scope: 'self', ids: [ownId] }     an individual contributor
 *   { scope: 'none', ids: [] }          a login with no employee record
 *
 * Managers are identified by the org chart, not by role: an `employee` who
 * happens to manage a team gets team scope.
 */
export async function visibleEmployees(req) {
  const role = req.user?.role;
  const selfId = req.user?.employee_id ?? null;

  if (role === 'admin' || role === 'hr_manager' || PAYROLL_ROLES.includes(role)) {
    return { scope: 'all', ids: null };
  }
  if (!selfId) return { scope: 'none', ids: [] };

  const rows = await query('SELECT id FROM employee_subtree($1)', [selfId]);
  const ids = rows.map((r) => r.id);
  return { scope: ids.length > 1 ? 'team' : 'self', ids };
}

/** True when the caller may see this particular employee's records. */
export async function canSeeEmployee(req, employeeId) {
  const v = await visibleEmployees(req);
  if (v.scope === 'all') return true;
  return v.ids.includes(Number(employeeId));
}

/**
 * SQL fragment restricting a query to the visible employees.
 * Returns null when no restriction is needed.
 */
export async function employeeScopeFilter(req, column, params) {
  const v = await visibleEmployees(req);
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
