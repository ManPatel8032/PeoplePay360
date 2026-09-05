import { Router } from 'express';
import { MATRIX } from '../auth.js';
import { ah } from '../lib/crud.js';

export const authRouter = Router();

/**
 * Section 1 Phase 1 Auth Stubs.
 * Full implementation lands in Phase 2.
 */

// POST /api/auth/login
authRouter.post('/login', ah(async (req, res) => {
  res.status(501).json({ error: 'Auth implementation lands in Phase 2' });
}));

// POST /api/auth/refresh
authRouter.post('/refresh', ah(async (req, res) => {
  res.status(501).json({ error: 'Token refresh lands in Phase 2' });
}));

// POST /api/auth/logout
authRouter.post('/logout', ah(async (req, res) => {
  res.status(204).end();
}));

// GET /api/auth/me
authRouter.get('/me', ah(async (req, res) => {
  res.json({
    data: {
      user: req.user,
      permissions: MATRIX,
    },
  });
}));

// POST /api/auth/change-password
authRouter.post('/change-password', ah(async (req, res) => {
  res.status(501).json({ error: 'Password change lands in Phase 2' });
}));

export default authRouter;
