import { Router } from 'express';
import { query } from '../db.js';
import { can } from '../auth.js';
import { ah } from '../lib/crud.js';

export const usersRouter = Router();

/**
 * GET /api/users
 * Lists users with linked employee names. Never returns password_hash.
 */
usersRouter.get('/', can('users', 'read'), ah(async (_req, res) => {
  const data = await query(
    `SELECT u.id, u.name, u.email, u.role, u.employee_id, u.is_active,
            u.must_change_password, u.failed_attempts, u.locked_until,
            u.last_login_at, u.created_at, e.name AS employee_name
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
      ORDER BY u.id`
  );
  res.json({ data });
}));

export default usersRouter;
