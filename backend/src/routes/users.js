/** User administration — Admin only (PS section 3: Admin). */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query, one } from '../db.js';
import { can, ROLES } from '../auth.js';
import { ah } from '../lib/crud.js';

export const usersRouter = Router();

/** Every projection goes through this list, so password_hash can never leak. */
const SAFE_COLUMNS = `
  u.id, u.name, u.email, u.role, u.employee_id, u.is_active,
  u.must_change_password, u.failed_attempts, u.locked_until,
  u.last_login_at, u.created_at`;

const USER_SQL = `
  SELECT ${SAFE_COLUMNS}, e.name AS employee_name, d.name AS department_name
    FROM users u
    LEFT JOIN employees e ON e.id = u.employee_id
    LEFT JOIN departments d ON d.id = e.department_id`;

const createSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required'),
  email: z.string({ required_error: 'Email is required' }).trim().email('Enter a valid email address'),
  role: z.enum(ROLES, { errorMap: () => ({ message: `Role must be one of: ${ROLES.join(', ')}` }) }),
  employee_id: z.union([z.number().int().positive(), z.null()]).optional(),
  password: z.string({ required_error: 'Password is required' }).min(10, 'Password must be at least 10 characters'),
  must_change_password: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).optional(),
  role: z.enum(ROLES).optional(),
  employee_id: z.union([z.number().int().positive(), z.null()]).optional(),
  is_active: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No fields provided' });

const passwordSchema = z.object({
  newPassword: z.string({ required_error: 'New password is required' }).min(10, 'Password must be at least 10 characters'),
});

const bad = (res, parsed) =>
  res.status(400).json({ error: parsed.error.errors[0]?.message || 'Invalid input' });

/** Refuse the change that would leave nobody able to administer the system. */
async function wouldOrphanAdmins(userId, { role, is_active }) {
  const losingAdmin =
    (role !== undefined && role !== 'admin') || is_active === false;
  if (!losingAdmin) return false;

  const target = await one('SELECT role, is_active FROM users WHERE id = $1', [userId]);
  if (!target || target.role !== 'admin' || !target.is_active) return false;

  const others = await one(
    `SELECT COUNT(*)::int n FROM users
      WHERE role = 'admin' AND is_active = TRUE AND id <> $1`,
    [userId]
  );
  return others.n === 0;
}

/**
 * ---------- list ----------
 * Employee-centric: every employee appears, whether or not they have a login,
 * so an admin can see who still needs an account. Logins with no employee
 * record (the IT admin) are appended at the end.
 */
usersRouter.get('/', can('users', 'read'), ah(async (_req, res) => {
  const data = await query(
    `SELECT e.id            AS employee_id,
            e.employee_number,
            e.name          AS employee_name,
            e.work_email,
            e.status        AS employee_status,
            d.name          AS department_name,
            j.name          AS job_position_name,
            m.name          AS manager_name,
            u.id            AS user_id,
            u.name, u.email, u.role, u.is_active,
            u.must_change_password, u.locked_until, u.last_login_at,
            (SELECT COUNT(*) FROM employees r WHERE r.manager_id = e.id)::int AS direct_reports
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN job_positions j ON j.id = e.job_position_id
       LEFT JOIN employees m ON m.id = e.manager_id
       LEFT JOIN users u ON u.employee_id = e.id

      UNION ALL

     SELECT NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
            u.id, u.name, u.email, u.role, u.is_active,
            u.must_change_password, u.locked_until, u.last_login_at, 0
       FROM users u
      WHERE u.employee_id IS NULL

      ORDER BY employee_number NULLS LAST`
  );
  res.json({ data });
}));

usersRouter.get('/:id', can('users', 'read'), ah(async (req, res) => {
  const row = await one(`${USER_SQL} WHERE u.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: row });
}));

/** Employees who do not yet have a login — the pick list for "create user". */
usersRouter.get('/linkable/employees', can('users', 'read'), ah(async (_req, res) => {
  const data = await query(
    `SELECT e.id, e.name, e.work_email, d.name AS department_name
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id = e.id)
        AND e.status <> 'inactive'
      ORDER BY e.name`
  );
  res.json({ data });
}));

// ---------- create ----------
usersRouter.post('/', can('users', 'write'), ah(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);
  const { name, email, role, employee_id = null, password, must_change_password = true } = parsed.data;

  let userEmail = email;
  if (employee_id) {
    const emp = await one('SELECT id, work_email FROM employees WHERE id = $1', [employee_id]);
    if (!emp) return res.status(400).json({ error: 'Linked employee does not exist', fields: { employee_id: ['Unknown employee'] } });

    const linked = await one('SELECT 1 FROM users WHERE employee_id = $1', [employee_id]);
    if (linked) {
      return res.status(400).json({ error: 'That employee already has an account', fields: { employee_id: ['Already linked'] } });
    }
    if (emp.work_email) {
      userEmail = emp.work_email;
    }
  }

  const emailTaken = await one('SELECT 1 FROM users WHERE LOWER(email) = LOWER($1)', [userEmail]);
  if (emailTaken) {
    return res.status(400).json({ error: 'That email already has an account', fields: { email: ['Already in use'] } });
  }

  const created = await one(
    `INSERT INTO users (name, email, password_hash, role, employee_id, is_active, must_change_password)
     VALUES ($1,$2,$3,$4,$5,TRUE,$6) RETURNING id`,
    [name, userEmail, await bcrypt.hash(password, 10), role, employee_id, must_change_password]
  );
  res.status(201).json({ data: await one(`${USER_SQL} WHERE u.id = $1`, [created.id]) });
}));

// ---------- update (role assignment, activation, employee link) ----------
usersRouter.patch('/:id', can('users', 'write'), ah(async (req, res) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const id = Number(req.params.id);
  const existing = await one('SELECT * FROM users WHERE id = $1', [id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, role, employee_id, is_active } = parsed.data;

  // An admin must not be able to lock themselves out or self-promote quietly.
  if (id === req.user.id && role !== undefined && role !== existing.role) {
    return res.status(400).json({ error: 'You cannot change your own role' });
  }
  if (id === req.user.id && is_active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  if (await wouldOrphanAdmins(id, { role, is_active })) {
    return res.status(400).json({ error: 'This is the last active admin — promote another admin first' });
  }

  let empEmail = null;
  if (employee_id) {
    const emp = await one('SELECT id, work_email FROM employees WHERE id = $1', [employee_id]);
    if (!emp) return res.status(400).json({ error: 'Linked employee does not exist', fields: { employee_id: ['Unknown employee'] } });

    const linked = await one('SELECT id FROM users WHERE employee_id = $1 AND id <> $2', [employee_id, id]);
    if (linked) {
      return res.status(400).json({ error: 'That employee already has an account', fields: { employee_id: ['Already linked'] } });
    }
    if (emp.work_email) {
      empEmail = emp.work_email;
    }
  }

  await query(
    `UPDATE users SET
       name        = COALESCE($1, name),
       email       = COALESCE($2, email),
       role        = COALESCE($3, role),
       employee_id = CASE WHEN $4::boolean THEN $5 ELSE employee_id END,
       is_active   = COALESCE($6, is_active)
     WHERE id = $7`,
    [name ?? null, empEmail, role ?? null, employee_id !== undefined, employee_id ?? null, is_active ?? null, id]
  );

  // Deactivating someone must also end their sessions immediately.
  if (is_active === false) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
  }

  res.json({ data: await one(`${USER_SQL} WHERE u.id = $1`, [id]) });
}));

// ---------- reset password ----------
usersRouter.post('/:id/reset-password', can('users', 'write'), ah(async (req, res) => {
  const parsed = passwordSchema.safeParse(req.body);
  if (!parsed.success) return bad(res, parsed);

  const id = Number(req.params.id);
  const existing = await one('SELECT id FROM users WHERE id = $1', [id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  await query(
    `UPDATE users
        SET password_hash = $1, must_change_password = TRUE,
            failed_attempts = 0, locked_until = NULL
      WHERE id = $2`,
    [await bcrypt.hash(parsed.data.newPassword, 10), id]
  );
  // Force a fresh login everywhere with the new credentials.
  await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);

  res.json({ data: { id, must_change_password: true } });
}));

/** Clear a lockout without changing the password. */
usersRouter.post('/:id/unlock', can('users', 'write'), ah(async (req, res) => {
  const row = await one(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1 RETURNING id',
    [req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: await one(`${USER_SQL} WHERE u.id = $1`, [req.params.id]) });
}));

export default usersRouter;
