/** Attendance (B3). Owner: Track B / Section 2. */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can, scopeToSelf } from '../auth.js';
import { ah } from '../lib/crud.js';
import { hoursBetween } from '../lib/dates.js';

export const attendance = Router();

const ATT_SQL = `
  SELECT a.*, e.name AS employee_name, d.name AS department_name,
         ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))::numeric / 3600, 2) AS worked_hours
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id`;

// Current user's today status (for quick check-in/out widget)
attendance.get('/today-status', can('attendance', 'read'), ah(async (req, res) => {
  const empId = req.user?.employee_id;
  if (!empId) return res.json({ data: null });

  // Find latest record for today or currently open record
  const record = await one(
    `${ATT_SQL} WHERE a.employee_id = $1 ORDER BY a.check_in DESC LIMIT 1`,
    [empId]
  );
  res.json({ data: record });
}));

// List attendance records
attendance.get('/', can('attendance', 'read'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  const employeeId = selfId || req.query.employee_id;
  const status = req.query.status;
  const missingCheckout = req.query.missing_checkout === 'true' || req.query.missing_checkout === true;
  const search = req.query.search;

  const where = [];
  const params = [];

  if (employeeId) {
    params.push(employeeId);
    where.push(`a.employee_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (missingCheckout) {
    where.push(`a.check_out IS NULL`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`e.name ILIKE $${params.length}`);
  }

  const limit = Math.min(Number(req.query.limit) || 200, 500);
  params.push(limit);

  const sql = `${ATT_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.check_in DESC LIMIT $${params.length}`;
  const rows = await query(sql, params);
  res.json({ data: rows, meta: { total: rows.length } });
}));

// Get attendance item
attendance.get('/:id', can('attendance', 'read'), ah(async (req, res) => {
  const row = await one(`${ATT_SQL} WHERE a.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const selfId = scopeToSelf(req);
  if (selfId && row.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot view attendance for another employee' });
  }
  res.json({ data: row });
}));

// Quick check-in for current employee (or manager for another employee)
attendance.post('/check-in', can('attendance', 'write'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  let employeeId = selfId;
  if (!employeeId) {
    employeeId = req.body.employee_id || req.user?.employee_id;
  }
  if (!employeeId) return res.status(400).json({ error: 'No employee associated with this account' });

  // Check if open record already exists
  const open = await one(
    'SELECT * FROM attendance WHERE employee_id = $1 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
    [employeeId]
  );
  if (open) {
    return res.status(400).json({ error: 'Already checked in without checking out' });
  }

  const checkIn = req.body.check_in || new Date().toISOString();
  const notes = req.body.notes || null;

  const inserted = await one(
    `INSERT INTO attendance (employee_id, check_in, status, manual_edit, notes)
     VALUES ($1, $2, 'present', FALSE, $3) RETURNING id`,
    [employeeId, checkIn, notes]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [inserted.id]);
  res.status(201).json({ data: full });
}));

// Quick check-out for currently active record of caller
attendance.post('/check-out', can('attendance', 'write'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  let employeeId = selfId || req.body.employee_id || req.user?.employee_id;
  if (!employeeId) return res.status(400).json({ error: 'No employee specified' });

  const open = await one(
    'SELECT * FROM attendance WHERE employee_id = $1 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
    [employeeId]
  );
  if (!open) return res.status(400).json({ error: 'No active check-in found to check out' });

  const at = req.body.check_out || new Date().toISOString();
  const h = hoursBetween(open.check_in, at);
  const status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : (open.status || 'present');

  const updated = await one(
    'UPDATE attendance SET check_out=$1, status=$2 WHERE id=$3 RETURNING id',
    [at, status, open.id]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [updated.id]);
  res.json({ data: full });
}));

// Check-out specific record
attendance.post('/:id/check-out', can('attendance', 'write'), ah(async (req, res) => {
  const at = req.body.check_out || new Date().toISOString();
  const row = await one('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.check_out) return res.status(400).json({ error: 'Already checked out' });

  const selfId = scopeToSelf(req);
  if (selfId && row.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot check out for another employee' });
  }

  const h = hoursBetween(row.check_in, at);
  const status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : (row.status || 'present');

  await one(
    'UPDATE attendance SET check_out=$1, status=$2 WHERE id=$3 RETURNING id',
    [at, status, row.id]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [row.id]);
  res.json({ data: full });
}));

// Create attendance manually
attendance.post('/', can('attendance', 'write'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  let { employee_id, check_in, check_out, status = 'present', notes } = req.body;

  // An employee may only ever log attendance against themselves, whatever the
  // body says. This assignment is the only thing enforcing that.
  if (selfId) {
    employee_id = selfId;
  }
  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
  if (!check_in) return res.status(400).json({ error: 'Check-in time is required' });

  if (check_out) {
    if (new Date(check_out) < new Date(check_in)) {
      return res.status(400).json({ error: 'Check-out time must be after check-in time' });
    }
    const h = hoursBetween(check_in, check_out);
    if (!req.body.status) {
      status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : 'present';
    }
  }

  const isManual = Boolean(req.body.manual_edit || req.user?.role !== 'employee');

  const inserted = await one(
    `INSERT INTO attendance (employee_id, check_in, check_out, status, manual_edit, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [employee_id, check_in, check_out || null, status, isManual, notes || null]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [inserted.id]);
  res.status(201).json({ data: full });
}));

// Correct attendance (restricted to HR Manager and above)
attendance.patch('/:id', can('attendance', 'write'), ah(async (req, res) => {
  // Requirement: "Corrections set manual_edit and are restricted to HR Manager and above; an Employee may create their own entry but not edit anyone else's."
  if (req.user?.role === 'employee') {
    return res.status(403).json({ error: 'Only HR Managers and Admins can correct attendance records' });
  }

  const existing = await one('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const employee_id = req.body.employee_id !== undefined ? req.body.employee_id : existing.employee_id;
  const check_in = req.body.check_in !== undefined ? req.body.check_in : existing.check_in;
  const check_out = req.body.check_out !== undefined ? req.body.check_out : existing.check_out;
  let status = req.body.status !== undefined ? req.body.status : existing.status;
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  if (check_out && check_in && new Date(check_out) < new Date(check_in)) {
    return res.status(400).json({ error: 'Check-out time must be after check-in time' });
  }

  if (check_out && check_in && req.body.status === undefined) {
    const h = hoursBetween(check_in, check_out);
    status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : status;
  }

  await one(
    `UPDATE attendance SET
       employee_id = $1, check_in = $2, check_out = $3,
       status = $4, manual_edit = TRUE, notes = $5
     WHERE id = $6 RETURNING id`,
    [employee_id, check_in, check_out || null, status, notes, req.params.id]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [req.params.id]);
  res.json({ data: full });
}));

// Delete attendance record
attendance.delete('/:id', can('employees', 'write'), ah(async (req, res) => {
  await query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));
