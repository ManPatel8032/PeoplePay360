/**
 * Demo auth: the client sends `x-user-id`. No passwords — this is a hackathon
 * prototype and the PS grades role-based *permissions*, not credential handling.
 * Swap in real sessions later; every route already goes through `can()`.
 */
import { one } from './db.js';

export const ROLES = ['employee', 'hr_manager', 'payroll_user', 'payroll_manager', 'admin'];

// module -> { read: minimum role, write: minimum role }
export const MATRIX = {
  employees:       { read: 'employee',     write: 'hr_manager' },
  contracts:       { read: 'employee',     write: 'hr_manager' },
  schedules:       { read: 'employee',     write: 'hr_manager' },
  attendance:      { read: 'employee',     write: 'employee' },
  timeoff:         { read: 'employee',     write: 'employee' },
  timeoff_approve: { read: 'hr_manager',   write: 'hr_manager' },
  allocations:     { read: 'employee',     write: 'hr_manager' },
  payruns:         { read: 'payroll_user', write: 'payroll_user' },
  payslips:        { read: 'employee',     write: 'payroll_user' },
  structures:      { read: 'payroll_user', write: 'payroll_manager' },
  rules:           { read: 'payroll_user', write: 'payroll_manager' },
  dashboard:       { read: 'payroll_user', write: 'admin' },
  users:           { read: 'admin',        write: 'admin' },
};

const rank = (role) => ROLES.indexOf(role);

export async function attachUser(req, _res, next) {
  try {
    const id = Number(req.header('x-user-id')) || 0;
    req.user =
      (id && (await one('SELECT * FROM users WHERE id = $1', [id]))) ||
      (await one('SELECT * FROM users ORDER BY id LIMIT 1'));
    next();
  } catch (err) {
    next(err);
  }
}

export function can(module, action = 'read') {
  return (req, res, next) => {
    const need = MATRIX[module]?.[action];
    if (!need) return next();
    if (rank(req.user?.role) < rank(need)) {
      return res
        .status(403)
        .json({ error: `Your role (${req.user?.role || 'none'}) cannot ${action} ${module}` });
    }
    next();
  };
}

/** Employees only ever see their own HR records. */
export const scopeToSelf = (req) => (req.user?.role === 'employee' ? req.user.employee_id : null);
