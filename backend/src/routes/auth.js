import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, one } from '../db.js';
import { permissionsFor } from '../auth.js';
import { ah } from '../lib/crud.js';
import {
  signAccessToken,
  generateRefreshToken,
  hashToken,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
} from '../lib/tokens.js';

export const authRouter = Router();

// Constant salt hash for constant-time comparison when email is not found
const DUMMY_HASH = '$2a$10$wT8Kz0g1F2l6w0fM2u9AjeB9pL8z0u0b2Z0k0i0l0e0p0a0t0e0l0';

/**
 * Rate limiter: 10 login attempts per IP per 15 minutes.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  // Count only FAILED attempts. Counting successful logins locks a demo out
  // after ten legitimate role switches, which is not what the limit is for.
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  },
});

export const loginSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),
  password: z.string({ required_error: 'Password is required' }).min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string({ required_error: 'Current password is required' }).min(1),
    newPassword: z.string({ required_error: 'New password is required' }).min(10, 'New password must be at least 10 characters'),
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password cannot be the same as current password',
    path: ['newPassword'],
  });

/**
 * Rate limiter for self-service signup: 5 per IP per hour.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  },
});

export const registerSchema = z.object({
  email: z.string({ required_error: 'Email is required' }).email('Invalid email address'),
  password: z
    .string({ required_error: 'Password is required' })
    .min(10, 'Password must be at least 10 characters'),
});

/**
 * POST /api/auth/register
 *
 * Self-service signup for staff who already have an employee record. This is
 * deliberately NOT open registration: payroll data must never be reachable by
 * someone who simply picked an email address.
 *
 *  - the email must match an existing employees.work_email
 *  - that employee must not already have a user account
 *  - the role is always 'employee'; a role in the body is ignored, so nobody
 *    can self-elevate to payroll or admin
 *
 * Both failure cases return one identical message so signup cannot be used to
 * enumerate who works here.
 */
authRouter.post('/register', registerLimiter, ah(async (req, res) => {
  const parseResult = registerSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input' });
  }

  const { email, password } = parseResult.data;
  const NOT_ELIGIBLE =
    'This work email is not eligible for sign up. Ask HR to create your employee record first.';

  const employee = await one(
    `SELECT e.id, e.name, e.work_email
       FROM employees e
      WHERE LOWER(e.work_email) = LOWER($1)`,
    [email.trim()]
  );
  if (!employee) return res.status(400).json({ error: NOT_ELIGIBLE });

  const taken = await one(
    `SELECT 1 FROM users WHERE employee_id = $1 OR LOWER(email) = LOWER($2)`,
    [employee.id, email.trim()]
  );
  if (taken) return res.status(400).json({ error: NOT_ELIGIBLE });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await one(
    `INSERT INTO users (name, email, password_hash, role, employee_id, is_active, must_change_password)
     VALUES ($1, $2, $3, 'employee', $4, TRUE, FALSE)
     RETURNING id, name, email, role, employee_id, is_active, must_change_password`,
    [employee.name, employee.work_email, passwordHash, employee.id]
  );

  // Log the new user straight in — same response shape as /login.
  const accessToken = signAccessToken(user);
  const rawRefreshToken = generateRefreshToken();
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + INTERVAL '7 days', $3)`,
    [user.id, hashToken(rawRefreshToken), req.headers['user-agent'] || null]
  );
  setRefreshTokenCookie(res, rawRefreshToken);

  res.status(201).json({ user, accessToken });
}));

/**
 * POST /api/auth/login
 * Validates credentials, checks lockout, generates tokens, and sets refresh cookie.
 */
authRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input' });
  }

  const { email, password } = parseResult.data;
  const user = await one(
    `SELECT id, name, email, role, employee_id, is_active, must_change_password, password_hash, failed_attempts, locked_until
       FROM users
      WHERE LOWER(email) = LOWER($1)`,
    [email.trim()]
  );

  // Constant-time execution when user doesn't exist (no enumeration)
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Check lockout
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remainingMs = new Date(user.locked_until).getTime() - Date.now();
    const remainingMins = Math.max(1, Math.ceil(remainingMs / 60000));
    return res.status(423).json({ error: `Account locked. Try again in ${remainingMins} minutes.` });
  }

  // Check inactive status
  if (!user.is_active) {
    return res.status(403).json({ error: 'This account has been deactivated.' });
  }

  // Compare password
  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    const attempts = (user.failed_attempts || 0) + 1;
    if (attempts >= 5) {
      await query(
        `UPDATE users
            SET failed_attempts = $1,
                locked_until = now() + INTERVAL '15 minutes'
          WHERE id = $2`,
        [attempts, user.id]
      );
    } else {
      await query(
        `UPDATE users SET failed_attempts = $1 WHERE id = $2`,
        [attempts, user.id]
      );
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Reset failed attempts & stamp last login
  await query(
    `UPDATE users
        SET failed_attempts = 0,
            locked_until = NULL,
            last_login_at = now()
      WHERE id = $1`,
    [user.id]
  );

  const accessToken = signAccessToken(user);
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);
  const userAgent = req.headers['user-agent'] || null;

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + INTERVAL '7 days', $3)`,
    [user.id, tokenHash, userAgent]
  );

  setRefreshTokenCookie(res, rawRefreshToken);

  res.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id,
      is_active: user.is_active,
      must_change_password: user.must_change_password,
    },
    accessToken,
  });
}));

/**
 * POST /api/auth/refresh
 * Token refresh with rotation and token family revocation on reuse.
 */
authRouter.post('/refresh', ah(async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) {
    return res.status(401).json({ error: 'Refresh token required' });
  }

  const tokenHash = hashToken(rawToken);
  const row = await one(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );

  if (!row) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  // Reuse of a revoked token -> revoke entire user token family
  if (row.revoked_at) {
    await query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [row.user_id]
    );
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: 'Session compromised. Please log in again.' });
  }

  // Check expiration
  if (new Date(row.expires_at) <= new Date()) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const user = await one(
    `SELECT id, name, email, role, employee_id, is_active, must_change_password
       FROM users WHERE id = $1`,
    [row.user_id]
  );

  if (!user || !user.is_active) {
    clearRefreshTokenCookie(res);
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }

  // Revoke old token
  await query(
    `UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1`,
    [row.id]
  );

  // Issue new tokens (rotation)
  const newRawRefreshToken = generateRefreshToken();
  const newTokenHash = hashToken(newRawRefreshToken);
  const userAgent = req.headers['user-agent'] || row.user_agent || null;

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + INTERVAL '7 days', $3)`,
    [user.id, newTokenHash, userAgent]
  );

  setRefreshTokenCookie(res, newRawRefreshToken);

  const accessToken = signAccessToken(user);
  res.json({ accessToken });
}));

/**
 * POST /api/auth/logout
 * Revokes current refresh token and clears cookie.
 */
authRouter.post('/logout', ah(async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await query(
      `UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash]
    );
  }
  clearRefreshTokenCookie(res);
  res.status(204).end();
}));

/**
 * GET /api/auth/me
 * Returns user profile and permission matrix for authenticated caller.
 */
authRouter.get('/me', ah(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.json({
    data: {
      user: req.user,
      permissions: permissionsFor(req.user?.role),
    },
  });
}));

/**
 * POST /api/auth/change-password
 * Verifies current password, enforces length >= 10, updates hash,
 * clears must_change_password, and revokes other refresh sessions.
 */
authRouter.post('/change-password', ah(async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const parseResult = changePasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input' });
  }

  const { currentPassword, newPassword } = parseResult.data;
  const user = await one(`SELECT password_hash FROM users WHERE id = $1`, [req.user.id]);
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) {
    return res.status(400).json({ error: 'Current password incorrect' });
  }

  const newHash = await bcrypt.hash(newPassword, 10);
  await query(
    `UPDATE users
        SET password_hash = $1,
            must_change_password = FALSE
      WHERE id = $2`,
    [newHash, req.user.id]
  );

  // Revoke all other refresh tokens for this user
  const currentRawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  const currentHash = currentRawToken ? hashToken(currentRawToken) : null;

  if (currentHash) {
    await query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE user_id = $1
          AND token_hash != $2
          AND revoked_at IS NULL`,
      [req.user.id, currentHash]
    );
  } else {
    await query(
      `UPDATE refresh_tokens
          SET revoked_at = now()
        WHERE user_id = $1
          AND revoked_at IS NULL`,
      [req.user.id]
    );
  }

  res.status(204).end();
}));

export default authRouter;
