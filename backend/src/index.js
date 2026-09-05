import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { migrate, waitForDb, query } from './db.js';
import { attachUser, permissionsFor } from './auth.js';
import { ah } from './lib/crud.js';
import authRouter from './routes/auth.js';
import usersRouter from './routes/users.js';
import { employees, departments, positions } from './routes/employees.js';
import { contracts } from './routes/contracts.js';
import { schedules } from './routes/schedules.js';
import { attendance } from './routes/attendance.js';
import * as timeoff from './routes/timeoff.js';
import * as payroll from './routes/payroll.js';
import dashboard from './routes/dashboard.js';

const app = express();
app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', ah(async (_req, res) => {
  const r = await query('SELECT 1 AS ok');
  res.json({ ok: true, db: r[0].ok === 1 });
}));

app.use('/api', attachUser);

// Section 1: Auth & User management
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);

// Backward-compatible me endpoint for demo role switcher
app.get('/api/me', (req, res) => res.json({ data: { user: req.user, permissions: permissionsFor(req.user?.role) } }));

// HR
app.use('/api/employees', employees);
app.use('/api/contracts', contracts);
app.use('/api/schedules', schedules);
app.use('/api/attendance', attendance);
app.use('/api/departments', departments);
app.use('/api/positions', positions);

// Time off
app.use('/api/time-off/types', timeoff.types);
app.use('/api/time-off/allocations', timeoff.allocations);
app.use('/api/time-off/requests', timeoff.withDuration, timeoff.requests);

// Payroll
app.use('/api/structures', payroll.structures);
app.use('/api/rules', payroll.rules);
app.use('/api/payruns', payroll.payruns);
app.use('/api/payslips', payroll.payslips);
app.use('/api/dashboard', dashboard);

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

/**
 * A rejected constraint is the caller sending bad data, not the server
 * failing — surface those as 400 rather than leaking a 500 and a raw
 * Postgres message.
 */
const PG_BAD_REQUEST = {
  '23514': 'check_violation',
  '23505': 'unique_violation',
  '23503': 'foreign_key_violation',
  '23502': 'not_null_violation',
  '22001': 'string_too_long',
  '22007': 'invalid_datetime',
  '22P02': 'invalid_text_representation',
};

function friendlyDbError(err) {
  switch (err.code) {
    case '23505':
      return 'That value is already in use';
    case '23503':
      return 'A referenced record does not exist';
    case '23502':
      return `${err.column ? `"${err.column}"` : 'A required field'} cannot be empty`;
    case '22P02':
    case '22007':
      return 'A value has the wrong format';
    default:
      // CHECK constraints and RAISE EXCEPTION carry their own readable text.
      return err.message;
  }
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.code && PG_BAD_REQUEST[err.code]) {
    console.warn(`[400] ${err.code} ${err.message}`);
    return res.status(400).json({ error: friendlyDbError(err), code: err.code });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = Number(process.env.PORT) || 3000;
await waitForDb();
await migrate();
app.listen(PORT, () => console.log(`PeoplePay360 API  ->  http://localhost:${PORT}`));

