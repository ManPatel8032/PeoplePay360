/** Time Off: types, allocations, requests + approval workflow (A4, B4). */
import { Router } from 'express';
import { query, one, tx } from '../db.js';
import { can, scope } from '../auth.js';
import { employeeScopeFilter, canSeeEmployee } from '../lib/guards.js';
import { ah } from '../lib/crud.js';
import { daysBetween, scheduledDays } from '../lib/dates.js';

/** Leave is booked in half-day steps — nothing finer. */
const INCREMENT = 0.5;
/** No single request may span more than a year. */
const MAX_REQUEST_DAYS = 366;
/** How far back an approver may date a request when recording it after the fact. */
const MAX_BACKDATE_DAYS = 365;

const today = () => new Date().toISOString().slice(0, 10);
const isIncrement = (n) => Math.abs(n / INCREMENT - Math.round(n / INCREMENT)) < 1e-9;

// =================== TYPES ===================
export const types = Router();

types.get('/', can('timeoff', 'read'), ah(async (_req, res) => {
  const rows = await query('SELECT * FROM time_off_types ORDER BY name');
  res.json({ data: rows, meta: { total: rows.length } });
}));

types.get('/:id', can('timeoff', 'read'), ah(async (req, res) => {
  const row = await one('SELECT * FROM time_off_types WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: row });
}));

types.post('/', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const { name, code, unit = 'day', requires_allocation = true, requires_approval = true, is_paid = true, color = '#4f46e5' } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
  if (!code || !code.trim()) return res.status(400).json({ error: 'Code is required' });

  const inserted = await one(
    `INSERT INTO time_off_types (name, code, unit, requires_allocation, requires_approval, is_paid, color)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [name.trim(), code.trim().toUpperCase(), unit, Boolean(requires_allocation), Boolean(requires_approval), Boolean(is_paid), color]
  );
  res.status(201).json({ data: inserted });
}));

types.patch('/:id', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM time_off_types WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const name = req.body.name !== undefined ? req.body.name.trim() : existing.name;
  const code = req.body.code !== undefined ? req.body.code.trim().toUpperCase() : existing.code;
  const unit = req.body.unit !== undefined ? req.body.unit : existing.unit;
  const requires_allocation = req.body.requires_allocation !== undefined ? Boolean(req.body.requires_allocation) : existing.requires_allocation;
  const requires_approval = req.body.requires_approval !== undefined ? Boolean(req.body.requires_approval) : existing.requires_approval;
  const is_paid = req.body.is_paid !== undefined ? Boolean(req.body.is_paid) : existing.is_paid;
  const color = req.body.color !== undefined ? req.body.color : existing.color;

  const updated = await one(
    `UPDATE time_off_types SET
       name=$1, code=$2, unit=$3, requires_allocation=$4, requires_approval=$5, is_paid=$6, color=$7
     WHERE id=$8 RETURNING *`,
    [name, code, unit, requires_allocation, requires_approval, is_paid, color, req.params.id]
  );
  res.json({ data: updated });
}));

/**
 * Deleting a type that is in use used to surface the raw FK failure
 * ("A referenced record does not exist"), which tells nobody what to do.
 * Check first and name the records that are holding it.
 */
types.delete('/:id', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const inUse = await one(
    `SELECT (SELECT COUNT(*)::int FROM time_off_requests WHERE type_id = $1) AS requests,
            (SELECT COUNT(*)::int FROM allocations       WHERE type_id = $1) AS allocations`,
    [req.params.id]
  );
  if (inUse.requests || inUse.allocations) {
    const parts = [];
    if (inUse.requests) parts.push(`${inUse.requests} leave request(s)`);
    if (inUse.allocations) parts.push(`${inUse.allocations} allocation(s)`);
    return res.status(409).json({
      error: `This leave type is used by ${parts.join(' and ')}, so it cannot be deleted. Rename it instead, or remove those records first.`,
      in_use: inUse,
    });
  }

  const gone = await one('DELETE FROM time_off_types WHERE id = $1 RETURNING id', [req.params.id]);
  if (!gone) return res.status(404).json({ error: 'Not found' });
  res.status(204).end();
}));


// =================== ALLOCATIONS ===================
// `taken` only counts leave that falls inside this allocation's own validity
// window — a 2030 grant must not appear to fund leave taken in 2041.
const ALLOC_SQL = `
  SELECT a.*, e.name AS employee_name, e.employee_number, t.name AS type_name, t.unit, t.color AS type_color,
         COALESCE((SELECT SUM(duration) FROM time_off_requests
                    WHERE employee_id = a.employee_id AND type_id = a.type_id AND state = 'approved'
                      AND date_from >= a.valid_from
                      AND (a.valid_to IS NULL OR date_to <= a.valid_to)), 0) AS taken
    FROM allocations a
    JOIN employees e ON e.id = a.employee_id
    JOIN time_off_types t ON t.id = a.type_id`;

export const allocations = Router();

allocations.get('/', can('allocations', 'read'), ah(async (req, res) => {
  const typeId = req.query.type_id;
  const state = req.query.state;
  const search = req.query.search;

  const where = [];
  const params = [];

  // Managers see their whole subtree; ICs see only their own.
  const scopeSql = employeeScopeFilter(req, 'a.employee_id', params);
  if (scopeSql) where.push(scopeSql);

  const employeeId = req.query.employee_id;

  if (employeeId) {
    params.push(employeeId);
    where.push(`a.employee_id = $${params.length}`);
  }
  if (typeId) {
    params.push(typeId);
    where.push(`a.type_id = $${params.length}`);
  }
  if (state) {
    params.push(state);
    where.push(`a.state = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(e.name ILIKE $${params.length} OR t.name ILIKE $${params.length})`);
  }

  const sql = `${ALLOC_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY a.valid_from DESC, a.id DESC`;
  const rows = await query(sql, params);
  res.json({
    data: rows.map((r) => ({
      ...r,
      amount: Number(r.amount),
      taken: Number(r.taken),
      remaining: Number(r.amount) - Number(r.taken),
    })),
    meta: { total: rows.length },
  });
}));

allocations.get('/:id', can('allocations', 'read'), ah(async (req, res) => {
  const row = await one(`${ALLOC_SQL} WHERE a.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canSeeEmployee(req, row.employee_id, 'allocations')) {
    return res.status(403).json({ error: 'This allocation is outside your team' });
  }
  res.json({
    data: {
      ...row,
      amount: Number(row.amount),
      taken: Number(row.taken),
      remaining: Number(row.amount) - Number(row.taken),
    },
  });
}));

allocations.post('/', can('allocations', 'write'), ah(async (req, res) => {
  const { employee_id, type_id, amount, state = 'approved', valid_from, valid_to, note } = req.body;
  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
  if (!type_id) return res.status(400).json({ error: 'Time off type is required' });
  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: 'Amount must be greater than 0' });
  if (!isIncrement(numAmount)) {
    return res.status(400).json({
      error: `Allocations are granted in steps of ${INCREMENT} — ${numAmount} is not a valid amount.`,
      fields: { amount: [`Use steps of ${INCREMENT}`] },
    });
  }
  if (!valid_from) return res.status(400).json({ error: 'Valid from date is required' });
  if (valid_to && valid_to < valid_from) return res.status(400).json({ error: 'Valid to must be on or after valid from date' });

  const inserted = await one(
    `INSERT INTO allocations (employee_id, type_id, amount, state, valid_from, valid_to, note)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [employee_id, type_id, numAmount, state, valid_from, valid_to || null, note || null]
  );

  const full = await one(`${ALLOC_SQL} WHERE a.id = $1`, [inserted.id]);
  res.status(201).json({
    data: {
      ...full,
      amount: Number(full.amount),
      taken: Number(full.taken),
      remaining: Number(full.amount) - Number(full.taken),
    },
  });
}));

allocations.post('/:id/approve', can('allocations', 'write'), ah(async (req, res) => {
  const row = await one("UPDATE allocations SET state='approved' WHERE id=$1 RETURNING id", [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const full = await one(`${ALLOC_SQL} WHERE a.id = $1`, [row.id]);
  res.json({
    data: {
      ...full,
      amount: Number(full.amount),
      taken: Number(full.taken),
      remaining: Number(full.amount) - Number(full.taken),
    },
  });
}));

allocations.post('/:id/refuse', can('allocations', 'write'), ah(async (req, res) => {
  const row = await one("UPDATE allocations SET state='refused' WHERE id=$1 RETURNING id", [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  const full = await one(`${ALLOC_SQL} WHERE a.id = $1`, [row.id]);
  res.json({ data: full });
}));

allocations.delete('/:id', can('allocations', 'write'), ah(async (req, res) => {
  await query('DELETE FROM allocations WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));


// =================== REQUESTS ===================
const REQ_SQL = `
  SELECT r.*, e.name AS employee_name, e.employee_number, d.name AS department_name,
         t.name AS type_name, t.unit, t.requires_allocation, t.is_paid, t.color AS type_color,
         u.name AS approver_name
    FROM time_off_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN time_off_types t ON t.id = r.type_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users u ON u.id = r.approver_id`;

/**
 * Balance for one (employee, type), measured against the dates being requested.
 *
 * An allocation only funds leave that falls inside its own validity window, so
 * a balance is meaningless without a date:
 *   `allocated` counts approved allocations whose window covers [from, to];
 *   `taken`     counts approved leave drawn from that same window.
 * Types that need no allocation are unlimited, so their `taken` is a plain
 * running total and `remaining` is not a limit.
 */
const BALANCE_SQL = `
  WITH cover AS (
    SELECT a.amount, a.valid_from, a.valid_to
      FROM allocations a
     WHERE a.employee_id = $1 AND a.type_id = $2 AND a.state = 'approved'
       AND a.valid_from <= $3::date
       AND (a.valid_to IS NULL OR a.valid_to >= $4::date)
  ), win AS (
    SELECT COALESCE(SUM(amount), 0)  AS allocated,
           MIN(valid_from)           AS window_from,
           MAX(valid_to)             AS window_to,
           COALESCE(bool_or(valid_to IS NULL), FALSE) AS open_ended
      FROM cover
  )
  SELECT w.allocated,
         w.window_from,
         CASE WHEN w.open_ended THEN NULL ELSE w.window_to END AS window_to,
         COALESCE((
           SELECT SUM(r.duration)
             FROM time_off_requests r
            WHERE r.employee_id = $1 AND r.type_id = $2 AND r.state = 'approved'
              AND (NOT (SELECT requires_allocation FROM time_off_types WHERE id = $2)
                   OR (r.date_from >= w.window_from
                       AND (w.open_ended OR r.date_to <= w.window_to)))
         ), 0) AS taken
    FROM win w`;

const shapeBalance = (row) => {
  const allocated = Number(row.allocated) || 0;
  const taken = Number(row.taken) || 0;
  return {
    allocated,
    taken,
    remaining: allocated - taken,
    window_from: row.window_from || null,
    window_to: row.window_to || null,
  };
};

export async function balanceFor(employeeId, typeId, opts = {}) {
  const from = opts.from || today();
  const to = opts.to || from;
  return shapeBalance(await one(BALANCE_SQL, [employeeId, typeId, from, to]));
}

/** Every type's balance for one employee on a given date — in one round trip. */
const BALANCES_SQL = `
  SELECT t.id AS type_id, t.name AS type_name, t.code, t.unit, t.color,
         t.is_paid, t.requires_allocation,
         COALESCE(c.allocated, 0) AS allocated,
         COALESCE(k.taken, 0)     AS taken,
         c.window_from,
         CASE WHEN c.open_ended THEN NULL ELSE c.window_to END AS window_to
    FROM time_off_types t
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS allocated, MIN(a.valid_from) AS window_from,
             MAX(a.valid_to) AS window_to,
             COALESCE(bool_or(a.valid_to IS NULL), FALSE) AS open_ended
        FROM allocations a
       WHERE a.employee_id = $1 AND a.type_id = t.id AND a.state = 'approved'
         AND a.valid_from <= $2::date
         AND (a.valid_to IS NULL OR a.valid_to >= $3::date)
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(r.duration) AS taken
        FROM time_off_requests r
       WHERE r.employee_id = $1 AND r.type_id = t.id AND r.state = 'approved'
         AND (NOT t.requires_allocation
              OR (r.date_from >= c.window_from
                  AND (c.open_ended OR r.date_to <= c.window_to)))
    ) k ON TRUE
   ORDER BY t.name`;

/**
 * The weekly pattern that applies to an employee on a date: the schedule on the
 * contract covering that date, else the employee's default schedule.
 */
async function scheduleLinesFor(employeeId, on) {
  const row = await one(
    `SELECT COALESCE(c.schedule_id, e.schedule_id) AS schedule_id
       FROM employees e
       LEFT JOIN LATERAL (
         SELECT schedule_id FROM contracts
          WHERE employee_id = e.id AND state IN ('running','expired')
            AND start_date <= $2::date AND (end_date IS NULL OR end_date >= $2::date)
          ORDER BY start_date DESC LIMIT 1
       ) c ON TRUE
      WHERE e.id = $1`,
    [employeeId, on]
  );
  if (!row?.schedule_id) return [];
  return query('SELECT * FROM schedule_lines WHERE schedule_id = $1', [row.schedule_id]);
}

/**
 * What a date range actually costs in leave. Weekends and other non-working
 * days are not leave, so they must never consume an allocation. With no
 * schedule on file we fall back to calendar days and say so.
 */
async function workingDaysFor(employeeId, from, to) {
  const lines = await scheduleLinesFor(employeeId, from);
  const calendar = daysBetween(from, to);
  if (!lines.length) return { working: calendar, calendar, scheduled: false };
  return { working: scheduledDays(lines, from, to), calendar, scheduled: true };
}

/** The first live request that collides with [from, to], if any. */
function overlappingRequest(employeeId, from, to, excludeId = null) {
  return one(
    `SELECT r.id, r.date_from, r.date_to, r.state, t.name AS type_name
       FROM time_off_requests r JOIN time_off_types t ON t.id = r.type_id
      WHERE r.employee_id = $1
        AND r.state IN ('draft','to_approve','approved')
        AND r.date_from <= $3::date AND r.date_to >= $2::date
        AND ($4::int IS NULL OR r.id <> $4::int)
      ORDER BY r.date_from LIMIT 1`,
    [employeeId, from, to, excludeId]
  );
}

const overlapError = (clash) => ({
  error: `This overlaps ${clash.type_name} already booked for ${clash.date_from} → ${clash.date_to} (${String(clash.state).replace('_', ' ')}). Cancel that request first.`,
  fields: { date_from: ['Overlaps an existing request'] },
  conflict: clash,
});

export const requests = Router();

/** What a date range costs, so the form can show it before anything is submitted. */
requests.get('/preview', can('timeoff', 'read'), ah(async (req, res) => {
  const employeeId = Number(req.query.employee_id || req.user?.employee_id || 0);
  const { date_from, date_to } = req.query;
  if (!employeeId) return res.status(400).json({ error: 'Employee is required' });
  if (!date_from || !date_to) return res.status(400).json({ error: 'Date from and date to are required' });
  if (date_to < date_from) return res.status(400).json({ error: 'Date to must be on or after date from' });
  if (!canSeeEmployee(req, employeeId, 'timeoff')) {
    return res.status(403).json({ error: 'This employee is outside your team' });
  }

  const days = await workingDaysFor(employeeId, date_from, date_to);
  const clash = await overlappingRequest(employeeId, date_from, date_to);
  res.json({
    data: {
      working_days: days.working,
      calendar_days: days.calendar,
      scheduled: days.scheduled,
      starts_in_past: date_from < today(),
      conflict: clash || null,
    },
  });
}));

requests.get('/balances/:employeeId', can('timeoff', 'read'), ah(async (req, res) => {
  const employeeId = Number(req.params.employeeId);
  if (!canSeeEmployee(req, employeeId, 'timeoff')) {
    return res.status(403).json({ error: 'This employee is outside your team' });
  }
  const on = req.query.on || today();
  const rows = await query(BALANCES_SQL, [employeeId, on, on]);
  res.json({ data: rows.map((r) => ({ ...r, ...shapeBalance(r) })), meta: { as_of: on } });
}));

requests.get('/', can('timeoff', 'read'), ah(async (req, res) => {
  const state = req.query.state;
  const typeId = req.query.type_id;
  const search = req.query.search;

  const where = [];
  const params = [];

  // Managers see their whole subtree; ICs see only their own.
  const scopeSql = employeeScopeFilter(req, 'r.employee_id', params);
  if (scopeSql) where.push(scopeSql);

  const employeeId = req.query.employee_id;

  if (employeeId) {
    params.push(employeeId);
    where.push(`r.employee_id = $${params.length}`);
  }
  if (state) {
    params.push(state);
    where.push(`r.state = $${params.length}`);
  }
  if (typeId) {
    params.push(typeId);
    where.push(`r.type_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(e.name ILIKE $${params.length} OR t.name ILIKE $${params.length})`);
  }

  const sql = `${REQ_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY r.date_from DESC, r.id DESC`;
  const rows = await query(sql, params);
  res.json({ data: rows, meta: { total: rows.length } });
}));

requests.get('/:id', can('timeoff', 'read'), ah(async (req, res) => {
  const row = await one(`${REQ_SQL} WHERE r.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canSeeEmployee(req, row.employee_id, 'timeoff')) {
    return res.status(403).json({ error: 'This request is outside your team' });
  }
  res.json({ data: row });
}));

requests.post('/', can('timeoff', 'write'), ah(async (req, res) => {
  const employee_id = Number(req.body.employee_id || req.user?.employee_id || 0) || null;
  const { type_id, date_from, date_to, reason } = req.body;

  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
  if (!canSeeEmployee(req, employee_id, 'timeoff', 'write')) {
    return res.status(403).json({ error: 'You can only book time off for yourself' });
  }
  if (!type_id) return res.status(400).json({ error: 'Time off type is required' });
  if (!date_from || !date_to) return res.status(400).json({ error: 'Date from and date to are required' });
  if (date_to < date_from) return res.status(400).json({ error: 'Date to must be on or after date from' });

  const span = daysBetween(date_from, date_to);
  if (span > MAX_REQUEST_DAYS) {
    return res.status(400).json({
      error: `A single request may not cover more than ${MAX_REQUEST_DAYS} days — this one covers ${span}. Split it into shorter requests.`,
      fields: { date_to: ['Range is too long'] },
    });
  }

  // Backdating: staff book ahead. Only an approver records leave after the
  // fact, and even then not indefinitely far back.
  const now = today();
  if (date_from < now) {
    if (scope(req, 'timeoff_approve', 'write') === 'none') {
      return res.status(400).json({
        error: 'Time off cannot start in the past. Ask HR to record leave that has already been taken.',
        fields: { date_from: ['Date is in the past'] },
      });
    }
    if (daysBetween(date_from, now) > MAX_BACKDATE_DAYS) {
      return res.status(400).json({
        error: `Leave cannot be recorded more than ${MAX_BACKDATE_DAYS} days after the fact.`,
        fields: { date_from: ['Too far in the past'] },
      });
    }
  }

  const type = await one('SELECT * FROM time_off_types WHERE id = $1', [type_id]);
  if (!type) return res.status(404).json({ error: 'Time off type not found' });

  const clash = await overlappingRequest(employee_id, date_from, date_to);
  if (clash) return res.status(409).json(overlapError(clash));

  const days = await workingDaysFor(employee_id, date_from, date_to);
  if (days.scheduled && days.working === 0) {
    return res.status(400).json({
      error: 'That range contains no scheduled working days, so there is nothing to take off.',
      fields: { date_from: ['No working days in range'] },
    });
  }

  const supplied = req.body.duration !== undefined && req.body.duration !== null && req.body.duration !== '';
  const duration = supplied ? Number(req.body.duration) : days.working;
  if (!Number.isFinite(duration) || duration <= 0) {
    return res.status(400).json({ error: 'Duration must be greater than 0', fields: { duration: ['Invalid duration'] } });
  }
  if (!isIncrement(duration)) {
    return res.status(400).json({
      error: `Time off is booked in steps of ${INCREMENT} ${type.unit}(s) — ${duration} is not a valid amount.`,
      fields: { duration: [`Use steps of ${INCREMENT}`] },
    });
  }
  if (type.unit === 'day' && duration > days.working) {
    return res.status(400).json({
      error: `${date_from} → ${date_to} has only ${days.working} working day(s), so ${duration} cannot be taken.`,
      fields: { duration: ['Longer than the range'] },
    });
  }

  // Guard: if an allocation is required, check the balance for these exact dates
  if (type.requires_allocation) {
    const bal = await balanceFor(employee_id, type_id, { from: date_from, to: date_to });
    if (bal.remaining < duration) {
      return res.status(400).json({
        error: bal.allocated === 0
          ? `No ${type.name} allocation covers ${date_from} → ${date_to}. Ask HR to grant one for that period.`
          : `Insufficient ${type.name} balance: ${bal.remaining} ${type.unit}(s) remaining, ${duration} requested`,
        fields: { duration: ['Exceeds remaining allocation'] },
        remaining: bal.remaining,
      });
    }
  }

  const initialState = type.requires_approval ? 'to_approve' : 'approved';
  const approverId = type.requires_approval ? null : (req.user?.id || null);

  const inserted = await one(
    `INSERT INTO time_off_requests (
       employee_id, type_id, date_from, date_to, duration, state, reason, approver_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [employee_id, type_id, date_from, date_to, duration, initialState, reason || null, approverId]
  );

  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [inserted.id]);
  const newBalance = await balanceFor(employee_id, type_id, { from: date_from, to: date_to });
  res.status(201).json({ data: { ...full, balance: newBalance } });
}));

/**
 * Approval is where the balance is actually spent, so it runs in one
 * transaction: the employee row is locked first, which serialises every
 * approval for that person, then the request row itself. Two approvers
 * clicking at the same moment can no longer both read the same remaining
 * balance and both spend it.
 */
requests.post('/:id/approve', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const out = await tx(async (c) => {
    const { rows: [r] } = await c.query('SELECT * FROM time_off_requests WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!r) return { status: 404, body: { error: 'Not found' } };
    await c.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [r.employee_id]);

    if (r.state === 'approved') return { status: 400, body: { error: 'Already approved' } };
    if (r.state === 'cancelled') return { status: 400, body: { error: 'A cancelled request cannot be approved' } };

    const { rows: [type] } = await c.query('SELECT * FROM time_off_types WHERE id = $1', [r.type_id]);

    const { rows: [clash] } = await c.query(
      `SELECT r2.id, r2.date_from, r2.date_to, r2.state, t.name AS type_name
         FROM time_off_requests r2 JOIN time_off_types t ON t.id = r2.type_id
        WHERE r2.employee_id = $1 AND r2.state = 'approved'
          AND r2.date_from <= $3::date AND r2.date_to >= $2::date AND r2.id <> $4
        ORDER BY r2.date_from LIMIT 1`,
      [r.employee_id, r.date_from, r.date_to, r.id]
    );
    if (clash) return { status: 409, body: overlapError(clash) };

    if (type.requires_allocation) {
      const { rows: [b] } = await c.query(BALANCE_SQL, [r.employee_id, r.type_id, r.date_from, r.date_to]);
      const bal = shapeBalance(b);
      if (bal.remaining < Number(r.duration)) {
        return {
          status: 400,
          body: {
            error: bal.allocated === 0
              ? `No ${type.name} allocation covers ${r.date_from} → ${r.date_to}.`
              : `Insufficient ${type.name} balance: ${bal.remaining} ${type.unit}(s) remaining, ${r.duration} requested`,
            fields: { duration: ['Exceeds remaining allocation'] },
            remaining: bal.remaining,
          },
        };
      }
    }

    await c.query(
      "UPDATE time_off_requests SET state='approved', approver_id=$1 WHERE id=$2",
      [req.user?.id || null, r.id]
    );
    return { status: 200, request: r };
  });

  if (out.body) return res.status(out.status).json(out.body);

  const r = out.request;
  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [r.id]);
  const balance = await balanceFor(r.employee_id, r.type_id, { from: r.date_from, to: r.date_to });
  res.json({ data: { ...full, balance } });
}));

requests.post('/:id/refuse', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const r = await one(REQ_SQL + ' WHERE r.id = $1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.state === 'refused') return res.status(400).json({ error: 'Already refused' });
  if (r.state === 'cancelled') return res.status(400).json({ error: 'A cancelled request cannot be refused' });

  await one(
    "UPDATE time_off_requests SET state='refused', approver_id=$1 WHERE id=$2 RETURNING id",
    [req.user?.id || null, req.params.id]
  );

  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [req.params.id]);
  const balance = await balanceFor(r.employee_id, r.type_id, { from: r.date_from, to: r.date_to });
  res.json({ data: { ...full, balance } });
}));

requests.post('/:id/cancel', can('timeoff', 'write'), ah(async (req, res) => {
  const r = await one(REQ_SQL + ' WHERE r.id = $1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.state === 'cancelled') return res.status(400).json({ error: 'Request is already cancelled' });

  if (!canSeeEmployee(req, r.employee_id, 'timeoff', 'write')) {
    return res.status(403).json({ error: "Cannot cancel another employee's leave request" });
  }

  await one("UPDATE time_off_requests SET state='cancelled' WHERE id=$1 RETURNING id", [r.id]);

  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [r.id]);
  const balance = await balanceFor(r.employee_id, r.type_id, { from: r.date_from, to: r.date_to });
  res.json({ data: { ...full, balance } });
}));

requests.delete('/:id', can('timeoff_approve', 'write'), ah(async (req, res) => {
  await query('DELETE FROM time_off_requests WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));
