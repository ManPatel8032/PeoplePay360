/**
 * Authentication + authorisation.
 *
 * The permission model is an EXPLICIT per-role table, not a rank ladder.
 * A ladder cannot express the problem statement, because the required
 * permissions are not monotonic:
 *
 *   Payslips —  Employee: own  ·  HR Manager: NONE  ·  Payroll User: all
 *
 * On a ladder, granting employees their own payslip automatically grants it to
 * every role above them, including HR Manager — which the PS forbids
 * ("HR Manager ... with no access to payroll features").
 *
 * Scopes:  'all'  every record
 *          'own'  only rows belonging to the caller's own employee record
 *          'none' no access
 *
 * `delete` is tracked separately from `write` because the PS gives Payroll User
 * "Create, Read, and Update access to Payruns and Payslips" — explicitly not delete.
 */
import { one } from './db.js';
import { verifyAccessToken } from './lib/tokens.js';

export const ROLES = ['employee', 'hr_manager', 'payroll_user', 'payroll_manager', 'admin'];

const NONE = { read: 'none', write: 'none', delete: 'none' };
const OWN_READ = { read: 'own', write: 'none', delete: 'none' };
const OWN_RW = { read: 'own', write: 'own', delete: 'none' };
const FULL = { read: 'all', write: 'all', delete: 'all' };
const READ_ALL = { read: 'all', write: 'none', delete: 'none' };
const CRU = { read: 'all', write: 'all', delete: 'none' };  // create/read/update, no delete

/** module -> role -> { read, write, delete } */
export const MATRIX = {
  //                employee     hr_manager  payroll_user  payroll_manager  admin
  employees:       { employee: OWN_READ, hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },
  contracts:       { employee: OWN_READ, hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },
  schedules:       { employee: NONE,     hr_manager: FULL,  payroll_user: READ_ALL, payroll_manager: READ_ALL, admin: FULL },
  attendance:      { employee: OWN_RW,   hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },
  timeoff:         { employee: OWN_RW,   hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },
  timeoff_approve: { employee: NONE,     hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },
  allocations:     { employee: OWN_READ, hr_manager: FULL,  payroll_user: FULL,     payroll_manager: FULL, admin: FULL },

  // Payroll — HR Manager is deliberately shut out of all four.
  payruns:         { employee: NONE,     hr_manager: NONE,  payroll_user: CRU,      payroll_manager: FULL, admin: FULL },
  payslips:        { employee: OWN_READ, hr_manager: NONE,  payroll_user: CRU,      payroll_manager: FULL, admin: FULL },
  structures:      { employee: NONE,     hr_manager: NONE,  payroll_user: READ_ALL, payroll_manager: FULL, admin: FULL },
  rules:           { employee: NONE,     hr_manager: NONE,  payroll_user: READ_ALL, payroll_manager: FULL, admin: FULL },

  dashboard:       { employee: NONE,     hr_manager: NONE,  payroll_user: READ_ALL, payroll_manager: READ_ALL, admin: READ_ALL },
  users:           { employee: NONE,     hr_manager: NONE,  payroll_user: NONE,     payroll_manager: NONE, admin: FULL },
};

/**
 * The caller's scope for one module + action: 'all' | 'own' | 'none'.
 * This is the single source of truth for both the route guard and row filtering.
 */
export function scope(req, module, action = 'read') {
  const role = req.user?.role;
  if (!role) return 'none';
  return MATRIX[module]?.[role]?.[action] ?? 'none';
}

/** Permissions for the signed-in user, sent to the client so the UI can match. */
export function permissionsFor(role) {
  const out = {};
  for (const [module, byRole] of Object.entries(MATRIX)) {
    out[module] = byRole[role] ?? NONE;
  }
  return out;
}

export async function attachUser(req, _res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7).trim();
      const payload = verifyAccessToken(token);
      if (payload?.id) {
        const user = await one(
          `SELECT id, name, email, role, employee_id, is_active, must_change_password
             FROM users
            WHERE id = $1 AND is_active = TRUE`,
          [payload.id]
        );
        if (user) {
          req.user = user;
          return next();
        }
      }
    }

    /*
     * Dev-only impersonation. Gated behind an explicit opt-in rather than just
     * NODE_ENV, so an unset environment variable on a deploy cannot silently
     * turn the whole API into an open door.
     */
    if (process.env.ALLOW_DEV_AUTH === '1' && process.env.NODE_ENV !== 'production') {
      const id = Number(req.header('x-user-id')) || 0;
      if (id) {
        const user = await one(
          `SELECT id, name, email, role, employee_id, is_active, must_change_password
             FROM users WHERE id = $1 AND is_active = TRUE`,
          [id]
        );
        if (user) {
          req.user = user;
          return next();
        }
      }
    }

    req.user = null;
    next();
  } catch (err) {
    next(err);
  }
}

/** Route guard. `action` is 'read' | 'write' | 'delete'. */
export function can(module, action = 'read') {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const allowed = scope(req, module, action);
    if (allowed === 'none') {
      return res.status(403).json({
        error: `Your role (${req.user.role}) cannot ${action} ${module}`,
      });
    }
    next();
  };
}

/**
 * The employee id a caller is limited to, or null when they see everything.
 * Employees are scoped to their own record — being a manager in the org chart
 * grants nothing, because the PS gives Employee no access to anyone else's data.
 */
export function selfScope(req, module = 'employees', action = 'read') {
  return scope(req, module, action) === 'own' ? (req.user?.employee_id ?? 0) : null;
}

/** Backwards-compatible alias used by older route code. */
export const scopeToSelf = (req) => selfScope(req, 'employees', 'read');
