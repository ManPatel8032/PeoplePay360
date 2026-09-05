/** Attendance (B3). Owner: Track B / Section 2. */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can, scopeToSelf } from '../auth.js';
import { ah } from '../lib/crud.js';
import { hoursBetween } from '../lib/dates.js';
import { blockManagerAttendance, rejected, employeeScopeFilter, canSeeEmployee } from '../lib/guards.js';

export const attendance = Router();

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
  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isSelfOnly = role === 'employee' || role === 'payroll_user' || role === 'payroll_manager';
  const isHRManager = role === 'hr_manager';

  const status = req.query.status;
  const missingCheckout = req.query.missing_checkout === 'true' || req.query.missing_checkout === true;
  const search = req.query.search;

  const where = [];
  const params = [];

  if (isSelfOnly) {
    params.push(selfId || 0);
    where.push(`a.employee_id = $${params.length}`);
  } else if (isHRManager) {
    const employeeId = req.query.employee_id;
    if (employeeId) {
      params.push(employeeId, selfId || 0);
      where.push(`a.employee_id = $${params.length - 1} AND a.employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $${params.length}
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`);
    } else {
      params.push(selfId || 0);
      where.push(`a.employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $${params.length}
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`);
    }
  } else {
    // Admin: can filter by employee_id if provided
    const employeeId = req.query.employee_id;
    if (employeeId) {
      params.push(employeeId);
      where.push(`a.employee_id = $${params.length}`);
    }
  }

  const isMissingFilter = missingCheckout || status === 'missing_checkout';

  if (status && status !== 'missing_checkout') {
    params.push(status);
    where.push(`a.status = $${params.length}`);
  }
  if (isMissingFilter) {
    where.push(`a.check_out IS NULL`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`e.name ILIKE $${params.length}`);
  }

  // Calculate total missing checkout count across the scoped employee pool
  let missingCountSql;
  let missingCountParams;
  if (isSelfOnly) {
    missingCountSql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1';
    missingCountParams = [selfId || 0];
  } else if (isHRManager) {
    const employeeId = req.query.employee_id;
    if (employeeId) {
      missingCountSql = `SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1 AND employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $2
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`;
      missingCountParams = [employeeId, selfId || 0];
    } else {
      missingCountSql = `SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $1
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`;
      missingCountParams = [selfId || 0];
    }
  } else {
    // Admin: total missing checkouts across all (or for employee if filtered)
    const employeeId = req.query.employee_id;
    if (employeeId) {
      missingCountSql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1';
      missingCountParams = [employeeId];
    } else {
      missingCountSql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL';
      missingCountParams = [];
    }
  }

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
  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isSelfOnly = role === 'employee' || role === 'payroll_user' || role === 'payroll_manager';
  const isHRManager = role === 'hr_manager';

  let sql;
  let params;
  if (isSelfOnly) {
    sql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1';
    params = [selfId || 0];
  } else if (isHRManager) {
    const employeeId = req.query.employee_id;
    if (employeeId) {
      sql = `SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1 AND employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $2
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`;
      params = [employeeId, selfId || 0];
    } else {
      sql = `SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id IN (
        WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $1
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs
      )`;
      params = [selfId || 0];
    }
  } else {
    // Admin: can scope to specific employee or all
    const employeeId = req.query.employee_id;
    if (employeeId) {
      sql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL AND employee_id = $1';
      params = [employeeId];
    } else {
      sql = 'SELECT COUNT(*)::int AS count FROM attendance WHERE check_out IS NULL';
      params = [];
    }
  }

  const row = await one(sql, params);
  res.json({ data: { count: row?.count || 0 } });
}));

// Get attendance item
attendance.get('/:id', can('attendance', 'read'), ah(async (req, res) => {
  const row = await one(`${ATT_SQL} WHERE a.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });

  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isSelfOnly = role === 'employee' || role === 'payroll_user' || role === 'payroll_manager';
  const isHRManager = role === 'hr_manager';

  if (isSelfOnly && row.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot view attendance for another employee' });
  }

  if (isHRManager) {
    const isAllowed = await one(
      `WITH RECURSIVE subs AS (
        SELECT id FROM employees WHERE id = $1
        UNION ALL
        SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
      )
      SELECT id FROM subs WHERE id = $2`,
      [selfId, row.employee_id]
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Cannot view attendance for an employee not under your management' });
    }
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
  const status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : (open.status || 'present');

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

  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isOwn = Number(row.employee_id) === Number(selfId);
  const isHRManager = role === 'hr_manager';
  const isAdmin = role === 'admin';

  if (!isOwn && !isAdmin) {
    if (isHRManager) {
      const isAllowed = await one(
        `WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $1
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs WHERE id = $2`,
        [selfId, row.employee_id]
      );
      if (!isAllowed) {
        return res.status(403).json({ error: 'Cannot check out for an employee not under your management' });
      }
    } else {
      return res.status(403).json({ error: 'You can only check out for your own attendance record' });
    }
  }

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
  const status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : (row.status || 'present');
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
  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  if (!selfId && role !== 'admin') {
    return res.status(400).json({ error: 'No employee associated with this account' });
  }

  let updatedRows = [];
  if (role === 'admin') {
    updatedRows = await query(
      `UPDATE attendance
          SET check_out = check_in + INTERVAL '8 hours',
              status = 'present',
              manual_edit = TRUE,
              notes = COALESCE(notes, '') || ' [Closed missed check-out (8 hrs)]'
        WHERE check_out IS NULL
          AND check_in < NOW() - INTERVAL '12 hours'
        RETURNING id`
    );
  } else if (role === 'hr_manager') {
    updatedRows = await query(
      `UPDATE attendance
          SET check_out = check_in + INTERVAL '8 hours',
              status = 'present',
              manual_edit = TRUE,
              notes = COALESCE(notes, '') || ' [Closed missed check-out (8 hrs)]'
        WHERE check_out IS NULL
          AND check_in < NOW() - INTERVAL '12 hours'
          AND employee_id IN (
            WITH RECURSIVE subs AS (
              SELECT id FROM employees WHERE id = $1
              UNION ALL
              SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
            )
            SELECT id FROM subs
          )
        RETURNING id`,
      [selfId]
    );
  } else {
    // Self-only (employee, payroll_user, payroll_manager)
    updatedRows = await query(
      `UPDATE attendance
          SET check_out = check_in + INTERVAL '8 hours',
              status = 'present',
              manual_edit = TRUE,
              notes = COALESCE(notes, '') || ' [Closed missed check-out (8 hrs)]'
        WHERE check_out IS NULL
          AND check_in < NOW() - INTERVAL '12 hours'
          AND employee_id = $1
        RETURNING id`,
      [selfId]
    );
  }

  const count = updatedRows.length;
  res.json({
    message: `Successfully closed ${count} missed check-out(s) with standard 8-hour shifts.`,
    closed_count: count,
  });
}));

// Create attendance manually
attendance.post('/', can('attendance', 'write'), ah(async (req, res) => {
  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isSelfOnly = role === 'employee' || role === 'payroll_user' || role === 'payroll_manager';
  const isHRManager = role === 'hr_manager';

  if (role === 'admin') {
    return res.status(403).json({ error: 'Admins do not log individual attendance entries' });
  }

  let { employee_id, check_in, check_out, status = 'present', notes } = req.body;

  if (isSelfOnly) {
    employee_id = selfId;
  } else if (isHRManager) {
    if (!employee_id) {
      employee_id = selfId;
    } else if (Number(employee_id) !== Number(selfId)) {
      const underManagement = await one(
        `WITH RECURSIVE subs AS (
          SELECT id FROM employees WHERE id = $1
          UNION ALL
          SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
        )
        SELECT id FROM subs WHERE id = $2`,
        [selfId, employee_id]
      );
      if (!underManagement) {
        return res.status(403).json({ error: 'You can only log attendance for yourself or employees under your management' });
      }
    }
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

  const role = req.user?.role;
  const selfId = req.user?.employee_id;
  const isHRManager = role === 'hr_manager';
  const isPayroll = role === 'payroll_user' || role === 'payroll_manager';

  if (isPayroll && existing.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot edit attendance for another employee' });
  }

  if (isHRManager) {
    const isAllowed = await one(
      `WITH RECURSIVE subs AS (
        SELECT id FROM employees WHERE id = $1
        UNION ALL
        SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
      )
      SELECT id FROM subs WHERE id = $2`,
      [selfId, existing.employee_id]
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Cannot correct attendance for an employee not under your management' });
    }
  }

  let employee_id = req.body.employee_id !== undefined ? req.body.employee_id : existing.employee_id;
  if (isPayroll) {
    employee_id = selfId;
  } else if (isHRManager && employee_id) {
    const isAllowed = await one(
      `WITH RECURSIVE subs AS (
        SELECT id FROM employees WHERE id = $1
        UNION ALL
        SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
      )
      SELECT id FROM subs WHERE id = $2`,
      [selfId, employee_id]
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Cannot assign attendance to an employee not under your management' });
    }
  }

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
  const existing = await one('SELECT employee_id FROM attendance WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  // Deleting a record is the strongest form of "rejecting" it, so the
  // Admin-only rule for managers applies here too.
  if (rejected(res, await blockManagerAttendance(req, existing.employee_id))) return;

  if (req.user?.role === 'hr_manager') {
    const isAllowed = await one(
      `WITH RECURSIVE subs AS (
        SELECT id FROM employees WHERE id = $1
        UNION ALL
        SELECT e.id FROM employees e JOIN subs ON e.manager_id = subs.id
      )
      SELECT id FROM subs WHERE id = $2`,
      [req.user?.employee_id, existing.employee_id]
    );
    if (!isAllowed) {
      return res.status(403).json({ error: 'Cannot delete attendance for an employee not under your management' });
    }
  }

  await query('DELETE FROM attendance WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));
