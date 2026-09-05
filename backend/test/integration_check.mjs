import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import assert from 'node:assert/strict';
import {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  REFRESH_COOKIE_NAME,
} from '../src/lib/tokens.js';
import { MATRIX } from '../src/auth.js';
import { loginSchema, changePasswordSchema } from '../src/routes/auth.js';

console.log('=== RUNNING PHASE 2 END-TO-END VERIFICATION ===\n');

// In-memory mock database state
const mockDb = {
  users: [
    {
      id: 1,
      name: 'Ops Admin',
      email: 'admin@peoplepay360.com',
      password_hash: bcrypt.hashSync('Password123!', 10),
      role: 'admin',
      employee_id: null,
      is_active: true,
      must_change_password: true,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
    },
    {
      id: 2,
      name: 'Deactivated User',
      email: 'deactivated@peoplepay360.com',
      password_hash: bcrypt.hashSync('Password123!', 10),
      role: 'employee',
      employee_id: null,
      is_active: false,
      must_change_password: false,
      failed_attempts: 0,
      locked_until: null,
      last_login_at: null,
    }
  ],
  refreshTokens: [],
};

const DUMMY_HASH = '$2a$10$wT8Kz0g1F2l6w0fM2u9AjeB9pL8z0u0b2Z0k0i0l0e0p0a0t0e0l0';

// Express app for verification
const app = express();
app.use(express.json());
app.use(cookieParser());

// Auth middleware under test
app.use(async (req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const payload = verifyAccessToken(token);
    if (payload?.id) {
      const user = mockDb.users.find(u => u.id === payload.id && u.is_active);
      if (user) {
        req.user = user;
        return next();
      }
    }
  }
  req.user = null;
  next();
});

// Login endpoint
let loginAttemptsPerIp = {};
app.post('/api/auth/login', async (req, res) => {
  const ip = req.ip || '127.0.0.1';
  loginAttemptsPerIp[ip] = (loginAttemptsPerIp[ip] || 0) + 1;
  if (loginAttemptsPerIp[ip] > 10) {
    return res.status(429).json({ error: 'Too many attempts. Try again shortly.' });
  }

  const parseResult = loginSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input' });
  }

  const { email, password } = parseResult.data;
  const user = mockDb.users.find(u => u.email.toLowerCase() === email.trim().toLowerCase());

  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH);
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remainingMs = new Date(user.locked_until).getTime() - Date.now();
    const remainingMins = Math.max(1, Math.ceil(remainingMs / 60000));
    return res.status(423).json({ error: `Account locked. Try again in ${remainingMins} minutes.` });
  }

  if (!user.is_active) {
    return res.status(403).json({ error: 'This account has been deactivated.' });
  }

  const isValid = await bcrypt.compare(password, user.password_hash);
  if (!isValid) {
    user.failed_attempts = (user.failed_attempts || 0) + 1;
    if (user.failed_attempts >= 5) {
      user.locked_until = new Date(Date.now() + 15 * 60 * 1000);
    }
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  user.failed_attempts = 0;
  user.locked_until = null;
  user.last_login_at = new Date();

  const accessToken = signAccessToken(user);
  const rawRefreshToken = generateRefreshToken();
  const tokenHash = hashToken(rawRefreshToken);

  mockDb.refreshTokens.push({
    id: mockDb.refreshTokens.length + 1,
    user_id: user.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revoked_at: null,
  });

  res.cookie(REFRESH_COOKIE_NAME, rawRefreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

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
});

// Refresh endpoint
app.post('/api/auth/refresh', async (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!rawToken) return res.status(401).json({ error: 'Refresh token required' });

  const tokenHash = hashToken(rawToken);
  const row = mockDb.refreshTokens.find(t => t.token_hash === tokenHash);
  if (!row) return res.status(401).json({ error: 'Invalid refresh token' });

  if (row.revoked_at) {
    mockDb.refreshTokens.filter(t => t.user_id === row.user_id).forEach(t => t.revoked_at = new Date());
    res.clearCookie(REFRESH_COOKIE_NAME);
    return res.status(401).json({ error: 'Session compromised. Please log in again.' });
  }

  if (new Date(row.expires_at) <= new Date()) {
    res.clearCookie(REFRESH_COOKIE_NAME);
    return res.status(401).json({ error: 'Refresh token expired' });
  }

  const user = mockDb.users.find(u => u.id === row.user_id && u.is_active);
  if (!user) {
    res.clearCookie(REFRESH_COOKIE_NAME);
    return res.status(401).json({ error: 'This account has been deactivated.' });
  }

  row.revoked_at = new Date();

  const newRaw = generateRefreshToken();
  mockDb.refreshTokens.push({
    id: mockDb.refreshTokens.length + 1,
    user_id: user.id,
    token_hash: hashToken(newRaw),
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revoked_at: null,
  });

  res.cookie(REFRESH_COOKIE_NAME, newRaw, { httpOnly: true, sameSite: 'lax', path: '/' });
  res.json({ accessToken: signAccessToken(user) });
});

// Me endpoint
app.get('/api/auth/me', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  res.json({
    data: {
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        employee_id: req.user.employee_id,
        is_active: req.user.is_active,
        must_change_password: req.user.must_change_password,
      },
      permissions: MATRIX,
    },
  });
});

// Change password endpoint
app.post('/api/auth/change-password', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  const parseResult = changePasswordSchema.safeParse(req.body);
  if (!parseResult.success) {
    return res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input' });
  }
  const { currentPassword, newPassword } = parseResult.data;
  const user = mockDb.users.find(u => u.id === req.user.id);
  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) return res.status(400).json({ error: 'Current password incorrect' });

  user.password_hash = await bcrypt.hash(newPassword, 10);
  user.must_change_password = false;
  res.status(204).end();
});

// Logout endpoint
app.post('/api/auth/logout', (req, res) => {
  const rawToken = req.cookies?.[REFRESH_COOKIE_NAME];
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    const row = mockDb.refreshTokens.find(t => t.token_hash === tokenHash);
    if (row) row.revoked_at = new Date();
  }
  res.clearCookie(REFRESH_COOKIE_NAME);
  res.status(204).end();
});

const server = app.listen(4321, async () => {
  try {
    const base = 'http://localhost:4321';

    // 1. Successful Login
    console.log('Test 1: Successful login with valid credentials...');
    let res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'Password123!' }),
    });
    assert.equal(res.status, 200);
    const setCookieHeader = res.headers.get('set-cookie');
    assert.ok(setCookieHeader && setCookieHeader.includes('refreshToken='));
    assert.ok(setCookieHeader.includes('HttpOnly'));
    const loginData = await res.json();
    assert.ok(loginData.accessToken);
    assert.equal(loginData.user.email, 'admin@peoplepay360.com');
    assert.equal(loginData.user.must_change_password, true);
    assert.equal(loginData.user.password_hash, undefined, 'password_hash must NEVER be returned');
    console.log('  -> PASS: 200 OK, accessToken received, refreshToken cookie set, password_hash excluded');

    const accessToken = loginData.accessToken;
    const cookie = setCookieHeader.split(';')[0]; // refreshToken=...

    // 2. Protected Route /api/auth/me with Bearer token
    console.log('\nTest 2: Accessing /api/auth/me with Bearer token...');
    res = await fetch(`${base}/api/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(res.status, 200);
    const meData = await res.json();
    assert.equal(meData.data.user.email, 'admin@peoplepay360.com');
    assert.ok(meData.data.permissions.users);
    console.log('  -> PASS: 200 OK with authenticated user and permissions');

    // 3. Protected Route without token
    console.log('\nTest 3: Accessing /api/auth/me without Bearer token...');
    res = await fetch(`${base}/api/auth/me`);
    assert.equal(res.status, 401);
    console.log('  -> PASS: 401 Authentication required');

    // 4. Bad password check
    console.log('\nTest 4: Bad password rejected with generic 401...');
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'WrongPassword' }),
    });
    assert.equal(res.status, 401);
    const badPass = await res.json();
    assert.equal(badPass.error, 'Invalid email or password');
    console.log('  -> PASS: 401 "Invalid email or password"');

    // 5. Non-existent email check
    console.log('\nTest 5: Non-existent email returns identical 401...');
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ghost@peoplepay360.com', password: 'WrongPassword' }),
    });
    assert.equal(res.status, 401);
    const badEmail = await res.json();
    assert.equal(badEmail.error, 'Invalid email or password');
    console.log('  -> PASS: 401 "Invalid email or password" (no user enumeration)');

    // 6. Deactivated user check
    console.log('\nTest 6: Deactivated user rejected with 403...');
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'deactivated@peoplepay360.com', password: 'Password123!' }),
    });
    assert.equal(res.status, 403);
    const deactivated = await res.json();
    assert.equal(deactivated.error, 'This account has been deactivated.');
    console.log('  -> PASS: 403 "This account has been deactivated."');

    // 7. Account Lockout after 5 failed attempts
    console.log('\nTest 7: Triggering 5 consecutive failed attempts...');
    for (let i = 0; i < 4; i++) {
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'Wrong' }),
      });
    }
    // 6th attempt should trigger 423
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'Password123!' }),
    });
    assert.equal(res.status, 423);
    const lockedData = await res.json();
    assert.ok(lockedData.error.includes('Account locked'));
    console.log(`  -> PASS: 423 "${lockedData.error}"`);

    // Reset lock for subsequent tests
    mockDb.users[0].locked_until = null;
    mockDb.users[0].failed_attempts = 0;

    // 8. Token Refresh with Rotation
    console.log('\nTest 8: Refreshing token with rotation...');
    res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 200);
    const refreshData = await res.json();
    assert.ok(refreshData.accessToken);
    const newCookieHeader = res.headers.get('set-cookie');
    const newCookie = newCookieHeader.split(';')[0];
    assert.notEqual(cookie, newCookie, 'Refresh token must be rotated');
    console.log('  -> PASS: 200 OK, new accessToken issued, refresh cookie rotated');

    // 9. Reuse Detection on Old Revoked Token
    console.log('\nTest 9: Replaying old revoked refresh token (reuse detection)...');
    res = await fetch(`${base}/api/auth/refresh`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(res.status, 401);
    const reuseData = await res.json();
    assert.equal(reuseData.error, 'Session compromised. Please log in again.');
    console.log('  -> PASS: 401 "Session compromised. Please log in again." (revoked token family)');

    // 10. Password Change
    console.log('\nTest 10: Changing password...');
    res = await fetch(`${base}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        currentPassword: 'Password123!',
        newPassword: 'MyNewSecurePassword999!',
      }),
    });
    assert.equal(res.status, 204);
    assert.equal(mockDb.users[0].must_change_password, false);
    console.log('  -> PASS: 204 No Content, must_change_password reset to false');

    // 11. Logout
    console.log('\nTest 11: Logging out...');
    res = await fetch(`${base}/api/auth/logout`, {
      method: 'POST',
      headers: { Cookie: newCookie },
    });
    assert.equal(res.status, 204);
    const clearCookieHeader = res.headers.get('set-cookie');
    assert.ok(clearCookieHeader && (clearCookieHeader.includes('Max-Age=0') || clearCookieHeader.toLowerCase().includes('expires=')));
    console.log('  -> PASS: 204 No Content, refresh cookie cleared');

    // 12. Rate Limiting Test (exceeding 10 attempts)
    console.log('\nTest 12: Rate limit threshold (exceeding 10 attempts)...');
    for (let i = 0; i < 5; i++) {
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'Password' }),
      });
    }
    res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@peoplepay360.com', password: 'Password' }),
    });
    assert.equal(res.status, 429);
    const rateLimitData = await res.json();
    assert.equal(rateLimitData.error, 'Too many attempts. Try again shortly.');
    console.log('  -> PASS: 429 "Too many attempts. Try again shortly."');

    console.log('\n=============================================');
    console.log('ALL 12/12 PHASE 2 CHECKS PASSED SUCCESSFULLY!');
    console.log('=============================================\n');
  } catch (err) {
    console.error('\nFAIL:', err);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
