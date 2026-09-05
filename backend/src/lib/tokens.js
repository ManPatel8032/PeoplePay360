import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || 'pp360-dev-jwt-secret-key-change-in-production';
const ACCESS_TOKEN_EXPIRY = '15m';

export const REFRESH_COOKIE_NAME = 'refreshToken';

/**
 * Signs a 15-minute JWT access token.
 */
export function signAccessToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      employee_id: user.employee_id,
    },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

/**
 * Verifies a JWT access token. Returns payload or null if invalid/expired.
 */
export function verifyAccessToken(token) {
  try {
    return jwt.verify(token, EFFECTIVE_JWT_SECRET);
  } catch (_err) {
    return null;
  }
}

/**
 * Generates a cryptographically random 32-byte refresh token (hex string).
 */
export function generateRefreshToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes the SHA-256 hash of a token.
 * Tokens are never stored raw in the database.
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Cookie options for the refresh token cookie.
 */
export function getCookieOptions() {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
  };
}

/**
 * Sets the httpOnly refresh token cookie on the response.
 */
export function setRefreshTokenCookie(res, rawToken) {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, getCookieOptions());
}

/**
 * Clears the refresh token cookie.
 */
export function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}
