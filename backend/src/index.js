import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { migrate, waitForDb, query } from './db.js';
import { attachUser, MATRIX } from './auth.js';
import { ah } from './lib/crud.js';
import { employees, departments, positions } from './routes/employees.js';
import { contracts } from './routes/contracts.js';
import { schedules } from './routes/schedules.js';
import { attendance } from './routes/attendance.js';
import * as timeoff from './routes/timeoff.js';
import * as payroll from './routes/payroll.js';
import dashboard from './routes/dashboard.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', ah(async (_req, res) => {
  const r = await query('SELECT 1 AS ok');
  res.json({ ok: true, db: r[0].ok === 1 });
}));

app.use('/api', attachUser);

// Who am I + the role list, so the client can render the role switcher.
app.get('/api/me', (req, res) => res.json({ data: { user: req.user, permissions: MATRIX } }));
app.get('/api/users', ah(async (_req, res) => {
  const data = await query(
    `SELECT u.*, e.name AS employee_name FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id ORDER BY u.id`
  );
  res.json({ data });
}));

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
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
});

const PORT = Number(process.env.PORT) || 3000;
await waitForDb();
await migrate();
app.listen(PORT, () => console.log(`PeoplePay360 API  ->  http://localhost:${PORT}`));

