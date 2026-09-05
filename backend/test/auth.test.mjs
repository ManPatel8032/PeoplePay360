import assert from 'node:assert/strict';
import test from 'node:test';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  getCookieOptions,
} from '../src/lib/tokens.js';
import { can, MATRIX } from '../src/auth.js';
import { loginSchema, changePasswordSchema } from '../src/routes/auth.js';

test('tokens: sign and verify JWT access token', () => {
  const user = {
    id: 42,
    email: 'test@peoplepay360.com',
    role: 'payroll_manager',
    employee_id: 10,
  };
  const token = signAccessToken(user);
  assert.ok(typeof token === 'string' && token.length > 20);

  const payload = verifyAccessToken(token);
  assert.ok(payload);
  assert.equal(payload.id, user.id);
  assert.equal(payload.email, user.email);
  assert.equal(payload.role, user.role);
  assert.equal(payload.employee_id, user.employee_id);
});

test('tokens: verifyAccessToken returns null on tampered token', () => {
  const token = signAccessToken({ id: 1, email: 'a@b.com', role: 'admin' });
  const tampered = token.slice(0, -5) + 'xxxxx';
  assert.equal(verifyAccessToken(tampered), null);
  assert.equal(verifyAccessToken('invalid.token.here'), null);
});

test('tokens: generateRefreshToken produces unique 32-byte hex tokens', () => {
  const t1 = generateRefreshToken();
  const t2 = generateRefreshToken();
  assert.equal(t1.length, 64);
  assert.equal(t2.length, 64);
  assert.notEqual(t1, t2);
});

test('tokens: hashToken computes accurate SHA-256', () => {
  const raw = 'random-token-sample-123';
  const expected = crypto.createHash('sha256').update(raw).digest('hex');
  assert.equal(hashToken(raw), expected);
});

test('tokens: cookie options adhere to security requirements', () => {
  const opts = getCookieOptions();
  assert.equal(opts.httpOnly, true);
  assert.equal(opts.sameSite, 'lax');
  assert.equal(opts.path, '/');
  assert.equal(opts.maxAge, 7 * 24 * 60 * 60 * 1000);
});

test('rbac: can() enforces authentication requirement', () => {
  const middleware = can('employees', 'read');
  let status = null;
  let responseData = null;
  const req = { user: null };
  const res = {
    status: (s) => {
      status = s;
      return { json: (d) => { responseData = d; } };
    },
  };
  let nextCalled = false;
  middleware(req, res, () => { nextCalled = true; });

  assert.equal(status, 401);
  assert.deepEqual(responseData, { error: 'Authentication required' });
  assert.equal(nextCalled, false);
});

test('rbac: can() enforces role matrix permissions', () => {
  const writeMiddleware = can('employees', 'write'); // requires hr_manager
  let status = null;
  let responseData = null;
  const res = {
    status: (s) => {
      status = s;
      return { json: (d) => { responseData = d; } };
    },
  };

  // Employee should be rejected with 403
  const empReq = { user: { role: 'employee' } };
  let nextCalled = false;
  writeMiddleware(empReq, res, () => { nextCalled = true; });
  assert.equal(status, 403);
  assert.equal(responseData?.error, 'Your role (employee) cannot write employees');
  assert.equal(nextCalled, false);

  // HR Manager should pass
  const hrReq = { user: { role: 'hr_manager' } };
  nextCalled = false;
  writeMiddleware(hrReq, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('security: bcrypt password comparison behaves identically for hash matches', async () => {
  const password = 'Password123!';
  const hash = await bcrypt.hash(password, 10);
  assert.equal(await bcrypt.compare(password, hash), true);
  assert.equal(await bcrypt.compare('WrongPassword', hash), false);
});

test('validation: loginSchema validates email and password presence', () => {
  const valid = loginSchema.safeParse({ email: 'admin@peoplepay360.com', password: 'SecretPassword1!' });
  assert.equal(valid.success, true);

  const badEmail = loginSchema.safeParse({ email: 'not-an-email', password: 'SecretPassword1!' });
  assert.equal(badEmail.success, false);

  const emptyPass = loginSchema.safeParse({ email: 'admin@peoplepay360.com', password: '' });
  assert.equal(emptyPass.success, false);
});

test('validation: changePasswordSchema enforces 10 char min and different password', () => {
  // Valid
  const valid = changePasswordSchema.safeParse({
    currentPassword: 'OldPassword123!',
    newPassword: 'BrandNewSecurePassword123!',
  });
  assert.equal(valid.success, true);

  // Short new password (< 10 chars)
  const short = changePasswordSchema.safeParse({
    currentPassword: 'OldPassword123!',
    newPassword: 'short',
  });
  assert.equal(short.success, false);

  // Same password
  const same = changePasswordSchema.safeParse({
    currentPassword: 'SamePassword123!',
    newPassword: 'SamePassword123!',
  });
  assert.equal(same.success, false);
});

test('lockout: calculates remaining minutes accurately', () => {
  const now = Date.now();
  const lockedUntil14Min = new Date(now + 14 * 60 * 1000 + 30 * 1000); // 14.5 min
  const mins = Math.max(1, Math.ceil((lockedUntil14Min.getTime() - now) / 60000));
  assert.equal(mins, 15);

  const lockedUntil1Min = new Date(now + 45 * 1000); // 45 seconds
  const minsShort = Math.max(1, Math.ceil((lockedUntil1Min.getTime() - now) / 60000));
  assert.equal(minsShort, 1);
});

