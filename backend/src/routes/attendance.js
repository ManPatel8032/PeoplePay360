/** Attendance (B3). Owner: Track B / Section 2. */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can, scope } from '../auth.js';
import { ah } from '../lib/crud.js';
import { hoursBetween } from '../lib/dates.js';
import { blockManagerAttendance, rejected, employeeScopeFilter, canSeeEmployee } from '../lib/guards.js';

export const attendance = Router();

/**
 * Whose attendance may this caller write?
 *
 *   write scope 'own' → forced to their own record, whatever the body asks for
 *   write scope 'all' → any employee; defaults to themselves when unspecified
 *
 * Per the PS: an Employee may "create attendance entries" (their own), while
 * HR Manager and above have full CRUD across everyone.
 */
function writeTarget(req, requestedId) {
  const allowed = scope(req, 'attendance', 'write');
  const selfId = req.user?.employee_id ?? null;

  if (allowed === 'all') return { employeeId: requestedId || selfId };
  if (allowed === 'own') {
    if (!selfId) return { error: 'No employee record is linked to this account' };
    return { employeeId: selfId };
  }
  return { error: 'You cannot record attendance' };
}

/**
 * Get employee's scheduled full-day work hours for a specific date from their contract/schedule.
 * Defaults to 8 hours if no schedule is assigned.
 */
export async function getEmployeeFullDayHours(employeeId, checkInDate = new Date()) {
  if (!employeeId) return 8;
  try {
    const row = await one(
      `SELECT sl.start_time, sl.end_time, sl.break_minutes
         FROM contracts c
         JOIN schedule_lines sl ON sl.schedule_id = c.schedule_id
        WHERE c.employee_id = $1
          AND c.state = 'running'
          AND sl.day_of_week = EXTRACT(DOW FROM $2::timestamptz)
        LIMIT 1`,
      [employeeId, checkInDate]
    );
    if (row && row.start_time && row.end_time) {
      const [sh, sm] = row.start_time.split(':').map(Number);
      const [eh, em] = row.end_time.split(':').map(Number);
      const breakH = (Number(row.break_minutes) || 0) / 60;
      const scheduled = (eh + em / 60) - (sh + sm / 60) - breakH;
      if (scheduled > 0) return Math.round(scheduled * 100) / 100;
    }
  } catch (err) {
    // Fall back to standard 8 hours
  }
  return 8;
}

/**
 * Derive attendance status from worked hours:
 * - > max(fullDayHours + 1, 9): 'overtime'
 * - >= fullDayHours: 'present' (full day amount of work reached)
 * - > 4 and < fullDayHours: 'half_day' (half day is > 4 hrs and less than full day amount of work)
 * - <= 4 hours: 'absent' (less than or equal to 4 hours is under half day threshold)
 */
export function deriveAttendanceStatus(h, defaultStatus = 'present', fullDayHours = 8) {
  const fullDay = Number(fullDayHours) > 0 ? Number(fullDayHours) : 8;
  const otThreshold = Math.max(fullDay + 1, 9);
  if (h > otThreshold) return 'overtime';
  if (h >= fullDay) {
    return defaultStatus === 'overtime' || defaultStatus === 'half_day' || defaultStatus === 'absent'
      ? 'present'
      : defaultStatus;
  }
  if (h > 4) return 'half_day';
  return 'absent';
}

const ATT_SQL = `
  SELECT a.*, e.name AS employee_name, e.employee_number, d.name AS department_name,
         ROUND(EXTRACT(EPOCH FROM (COALESCE(a.check_out, NOW()) - a.check_in))::numeric / 3600, 2) AS worked_hours
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id`;

// Current user's today status (for quick check-in/out widget - current day only)
attendance.get('/today-status', can('attendance', 'read'), ah(async (req, res) => {
  const role = req.user?.role;
  if (role === 'admin') return res.json({ data: null });

  const empId = req.user?.employee_id;
  if (!empId) return res.json({ data: null });

  // Only display current day's record or active open shift started within the last 16 hours
  const record = await one(
    `${ATT_SQL}
      WHERE a.employee_id = $1
        AND (
          a.check_in >= CURRENT_DATE
          OR a.check_in >= NOW() - INTERVAL '24 hours'
          OR (a.check_out IS NULL AND a.check_in >= NOW() - INTERVAL '16 hours')
        )
      ORDER BY (a.check_out IS NULL) DESC, a.check_in DESC
      LIMIT 1`,
    [empId]
  );
  res.json({ data: record });
}));

// List attendance records
attendance.get('/', can('attendance', 'read'), ah(async (req, res) => {
  const status = req.query.status;
  const missingCheckout = req.query.missing_checkout === 'true' || req.query.missing_checkout === true;
  const search = req.query.search;

  const where = [];
  const params = [];

  // One visibility rule for the whole app, from the role matrix in auth.js.
  const scopeSql = employeeScopeFilter(req, 'a.employee_id', params, 'attendance');
  if (scopeSql) where.push(scopeSql);

  if (req.query.employee_id) {
    params.push(req.query.employee_id);
    where.push(`a.employee_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (missingCheckout) {
    where.push('a.check_out IS NULL');
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`e.name ILIKE $${params.length}`);
  }

  // Missing-checkout total over the same scoped pool, so the banner never
  // reports records the caller cannot see.
  const countParams = [];
  const countWhere = ['check_out IS NULL'];
  const countScope = employeeScopeFilter(req, 'employee_id', countParams, 'attendance');
  if (countScope) countWhere.push(countScope);
  if (req.query.employee_id) {
    countParams.push(req.query.employee_id);
    countWhere.push(`employee_id = $${countParams.length}`);
  }
  const missingCountSql = `SELECT COUNT(*)::int AS count FROM attendance WHERE ${countWhere.join(' AND ')}`;
  const missingCountParams = countParams;

  const missingCountRow = await one(missingCountSql, missingCountParams);
  const missingCount = missingCountRow?.count || 0;

  const limit = Math.min(Number(req.query.limit) || 200, 500);
  params.push(limit);

  const sql = `${ATT_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.check_in DESC LIMIT $${params.length}`;
  const rows = await query(sql, params);
  res.json({ data: rows, meta: { total: rows.length, missing_count: missingCount } });
}));

// Total missing count for scope
attendance.get('/missing-count', can('attendance', 'read'), ah(async (req, res) => {
  const params = [];
  const where = ['check_out IS NULL'];

  const scopeSql = employeeScopeFilter(req, 'employee_id', params, 'attendance');
  if (scopeSql) where.push(scopeSql);

  if (req.query.employee_id) {
    params.push(req.query.employee_id);
    where.push(`employee_id = $${params.length}`);
  }

  const row = await one(
    `SELECT COUNT(*)::int AS count FROM attendance WHERE ${where.join(' AND ')}`,
    params
  );
  res.json({ data: { count: row?.count || 0 } });
}));

// Get attendance item
attendance.get('/:id', can('attendance', 'read'), ah(async (req, res) => {
  const row = await one(`${ATT_SQL} WHERE a.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  if (!canSeeEmployee(req, row.employee_id, 'attendance')) {
    return res.status(403).json({ error: 'Cannot view attendance for another employee' });
  }

  res.json({ data: row });
}));

// Quick check-in for current employee (users can check in their own time only)
attendance.post('/check-in', can('attendance', 'write'), ah(async (req, res) => {
  const role = req.user?.role;
  if (role === 'admin') {
    return res.status(403).json({ error: 'Admins do not clock in' });
  }
  const selfId = req.user?.employee_id;
  if (!selfId) return res.status(400).json({ error: 'No employee associated with this account' });

  if (req.body.employee_id && Number(req.body.employee_id) !== Number(selfId)) {
    return res.status(403).json({ error: 'You can only check in for your own account' });
  }
  const employeeId = selfId;

  // Auto-close any stale unclosed attendance records from prior days (> 16 hours ago)
  await query(
    `UPDATE attendance
        SET check_out = check_in + INTERVAL '8 hours',
            status = 'present',
            manual_edit = TRUE,
            notes = COALESCE(notes, '') || ' [Auto-closed on next shift check-in]'
      WHERE employee_id = $1 AND check_out IS NULL
        AND check_in < NOW() - INTERVAL '16 hours'`,
    [employeeId]
  );

  // Check if open record already exists (active ongoing shift)
  const open = await one(
    'SELECT * FROM attendance WHERE employee_id = $1 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
    [employeeId]
  );
  if (open) {
    return res.status(400).json({
      error: 'Already checked in without checking out',
      check_in: open.check_in,
    });
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
  const role = req.user?.role;
  if (role === 'admin') {
    return res.status(403).json({ error: 'Admins do not clock out' });
  }
  const selfId = req.user?.employee_id;
  if (!selfId) return res.status(400).json({ error: 'No employee associated with this account' });

  if (req.body.employee_id && Number(req.body.employee_id) !== Number(selfId)) {
    return res.status(403).json({ error: 'You can only check out for your own account' });
  }
  const employeeId = selfId;

  const open = await one(
    'SELECT * FROM attendance WHERE employee_id = $1 AND check_out IS NULL ORDER BY check_in DESC LIMIT 1',
    [employeeId]
  );
  if (!open) {
    return res.status(400).json({ error: 'You have not checked in' });
  }

  const at = req.body.check_out || new Date().toISOString();
  const h = hoursBetween(open.check_in, at);
  const fullDay = await getEmployeeFullDayHours(employeeId, open.check_in);
  const status = deriveAttendanceStatus(h, open.status || 'present', fullDay);

  const updated = await one(
    'UPDATE attendance SET check_out=$1, status=$2 WHERE id=$3 RETURNING id',
    [at, status, open.id]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [updated.id]);
  res.json({ data: full });
}));

// Check-out specific record (caller can check out own record or HR Manager can close subordinate record)
attendance.post('/:id/check-out', can('attendance', 'write'), ah(async (req, res) => {
  const row = await one('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.check_out) return res.status(400).json({ error: 'Already checked out' });

  if (!canSeeEmployee(req, row.employee_id, 'attendance')) {
    return res.status(403).json({ error: 'You can only check out for your own attendance record' });
  }

  if (rejected(res, await blockManagerAttendance(req, row.employee_id))) return;

  // Calculate check_out time: if historical missed check-out (> 16 hours), cap to 8h shift
  let checkOutTime = req.body.check_out;
  let isHistorical = false;
  if (!checkOutTime) {
    const elapsedMs = Date.now() - new Date(row.check_in).getTime();
    if (elapsedMs > 16 * 3600 * 1000) {
      checkOutTime = new Date(new Date(row.check_in).getTime() + 8 * 3600 * 1000).toISOString();
      isHistorical = true;
    } else {
      checkOutTime = new Date().toISOString();
    }
  }

  const h = hoursBetween(row.check_in, checkOutTime);
  const fullDay = await getEmployeeFullDayHours(row.employee_id, row.check_in);
  const status = deriveAttendanceStatus(h, row.status || 'present', fullDay);
  const notes = isHistorical
    ? (row.notes ? `${row.notes} [Missed check-out closed]` : 'Missed check-out closed (standard 8 hrs)')
    : row.notes;

  await one(
    'UPDATE attendance SET check_out=$1, status=$2, manual_edit=$3, notes=$4 WHERE id=$5 RETURNING id',
    [checkOutTime, status, isHistorical || Boolean(row.manual_edit), notes, row.id]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [row.id]);
  res.json({ data: full });
}));

// Close all missed check-outs for user (or subordinates for HR Manager, or all for Admin)
attendance.post('/close-missed-checkouts', can('attendance', 'write'), ah(async (req, res) => {
  const params = [];
  const where = ["check_out IS NULL", "check_in < NOW() - INTERVAL '12 hours'"];

  const scopeSql = employeeScopeFilter(req, 'employee_id', params, 'attendance');
  if (scopeSql) where.push(scopeSql);

  // Managers' attendance requires admin review
  if (req.user?.role !== 'admin') {
    where.push('employee_id NOT IN (SELECT manager_id FROM employees WHERE manager_id IS NOT NULL)');
  }

  if (scope(req, 'attendance', 'write') === 'own' && !req.user?.employee_id) {
    return res.status(400).json({ error: 'No employee associated with this account' });
  }

  const updatedRows = await query(
    `UPDATE attendance
        SET check_out = check_in + INTERVAL '8 hours',
            status = 'present',
            manual_edit = TRUE,
            notes = COALESCE(notes, '') || ' [Closed missed check-out (8 hrs)]'
      WHERE ${where.join(' AND ')}
      RETURNING id`,
    params
  );

  const count = updatedRows.length;
  res.json({
    message: `Successfully closed ${count} missed check-out(s) with standard 8-hour shifts.`,
    closed_count: count,
  });
}));

// Create attendance manually
attendance.post('/', can('attendance', 'write'), ah(async (req, res) => {
  let { employee_id, check_in, check_out, status = 'present', notes } = req.body;

  // 'own' write scope forces the caller's own record whatever the body says;
  // 'all' may log for anyone, defaulting to themselves.
  const target = writeTarget(req, employee_id);
  if (target.error) return res.status(403).json({ error: target.error });
  employee_id = target.employeeId;

  if (!canSeeEmployee(req, employee_id, 'attendance', 'write')) {
    return res.status(403).json({ error: 'Cannot record attendance for this employee' });
  }
  if (employee_id !== req.user?.employee_id) {
    if (rejected(res, await blockManagerAttendance(req, employee_id))) return;
  }

  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
  if (!check_in) return res.status(400).json({ error: 'Check-in time is required' });

  if (check_out) {
    if (new Date(check_out) < new Date(check_in)) {
      return res.status(400).json({ error: 'Check-out time must be after check-in time' });
    }
    const h = hoursBetween(check_in, check_out);
    if (!req.body.status) {
      const fullDay = await getEmployeeFullDayHours(employee_id, check_in);
      status = deriveAttendanceStatus(h, 'present', fullDay);
    }
  }

  const role = req.user?.role;
  const isManual = Boolean(req.body.manual_edit || role !== 'employee');

  const inserted = await one(
    `INSERT INTO attendance (employee_id, check_in, check_out, status, manual_edit, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [employee_id, check_in, check_out || null, status, isManual, notes || null]
  );

  const full = await one(`${ATT_SQL} WHERE a.id = $1`, [inserted.id]);
  res.status(201).json({ data: full });
}));

// Correct attendance (restricted to HR Manager and above, or Payroll editing self)
attendance.patch('/:id', can('attendance', 'write'), ah(async (req, res) => {
  if (req.user?.role === 'employee') {
    return res.status(403).json({ error: 'Employees cannot correct attendance records' });
  }

  const existing = await one('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // A manager's own attendance is reviewed by an Admin only. Checked before the
  // scoping rules below, since it overrides them for every non-admin caller.
  if (rejected(res, await blockManagerAttendance(req, existing.employee_id))) return;

  if (!canSeeEmployee(req, existing.employee_id, 'attendance')) {
    return res.status(403).json({ error: 'Cannot edit attendance for another employee' });
  }

  const moved = writeTarget(req, req.body.employee_id ?? existing.employee_id);
  if (moved.error) return res.status(403).json({ error: moved.error });
  const employee_id = moved.employeeId;

  const check_in = req.body.check_in !== undefined ? req.body.check_in : existing.check_in;
  const check_out = req.body.check_out !== undefined ? req.body.check_out : existing.check_out;
  let status = req.body.status !== undefined ? req.body.status : existing.status;
  const notes = req.body.notes !== undefined ? req.body.notes : existing.notes;

  if (check_out && check_in && new Date(check_out) < new Date(check_in)) {
    return res.status(400).json({ error: 'Check-out time must be after check-in time' });
  }

  if (check_out && check_in && req.body.status === undefined) {
    const h = hoursBetween(check_in, check_out);
    const fullDay = await getEmployeeFullDayHours(employee_id, check_in);
    status = deriveAttendanceStatus(h, existing.status || 'present', fullDay);
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
attendance.delete('/:id', can('attendance', 'delete'), ah(async (req, res) => {
  const existing = await one('SELECT employee_id FROM attendance WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Deleting a record is the strongest form of "rejecting" it, so the
  // Admin-only rule for managers applies here too.
  if (rejected(res, await blockManagerAttendance(req, existing.employee_id))) return;

  if (!canSeeEmployee(req, existing.employee_id, 'attendance')) {
    return res.status(403).json({ error: 'Cannot delete attendance for another employee' });
  }

  await query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));
