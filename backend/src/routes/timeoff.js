/** Time Off: types, allocations, requests + approval workflow (A4, B4). */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can, scopeToSelf } from '../auth.js';
import { ah } from '../lib/crud.js';
import { daysBetween } from '../lib/dates.js';

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

types.delete('/:id', can('timeoff_approve', 'write'), ah(async (req, res) => {
  await query('DELETE FROM time_off_types WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));


// =================== ALLOCATIONS ===================
const ALLOC_SQL = `
  SELECT a.*, e.name AS employee_name, t.name AS type_name, t.unit, t.color AS type_color,
         COALESCE((SELECT SUM(duration) FROM time_off_requests
                    WHERE employee_id = a.employee_id AND type_id = a.type_id AND state = 'approved'), 0) AS taken
    FROM allocations a
    JOIN employees e ON e.id = a.employee_id
    JOIN time_off_types t ON t.id = a.type_id`;

export const allocations = Router();

allocations.get('/', can('allocations', 'read'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  const employeeId = selfId || req.query.employee_id;
  const typeId = req.query.type_id;
  const state = req.query.state;
  const search = req.query.search;

  const where = [];
  const params = [];

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
  const selfId = scopeToSelf(req);
  if (selfId && row.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot view allocation for another employee' });
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
  SELECT r.*, e.name AS employee_name, d.name AS department_name,
         t.name AS type_name, t.unit, t.requires_allocation, t.is_paid, t.color AS type_color,
         u.name AS approver_name
    FROM time_off_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN time_off_types t ON t.id = r.type_id
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN users u ON u.id = r.approver_id`;

export async function balanceFor(employeeId, typeId) {
  const row = await one(
    `SELECT
       COALESCE((SELECT SUM(amount) FROM allocations
                  WHERE employee_id=$1 AND type_id=$2 AND state='approved'), 0) AS allocated,
       COALESCE((SELECT SUM(duration) FROM time_off_requests
                  WHERE employee_id=$1 AND type_id=$2 AND state='approved'), 0) AS taken`,
    [employeeId, typeId]
  );
  const allocated = Number(row.allocated);
  const taken = Number(row.taken);
  return { allocated, taken, remaining: allocated - taken };
}

export const requests = Router();

requests.get('/balances/:employeeId', can('timeoff', 'read'), ah(async (req, res) => {
  const types = await query('SELECT * FROM time_off_types ORDER BY name');
  const data = [];
  for (const t of types) {
    data.push({
      type_id: t.id,
      type_name: t.name,
      code: t.code,
      unit: t.unit,
      color: t.color,
      is_paid: t.is_paid,
      requires_allocation: t.requires_allocation,
      ...(await balanceFor(req.params.employeeId, t.id)),
    });
  }
  res.json({ data });
}));

requests.get('/', can('timeoff', 'read'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  const employeeId = selfId || req.query.employee_id;
  const state = req.query.state;
  const typeId = req.query.type_id;
  const search = req.query.search;

  const where = [];
  const params = [];

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
  const selfId = scopeToSelf(req);
  if (selfId && row.employee_id !== selfId) {
    return res.status(403).json({ error: 'Cannot view request for another employee' });
  }
  res.json({ data: row });
}));

requests.post('/', can('timeoff', 'write'), ah(async (req, res) => {
  const selfId = scopeToSelf(req);
  let employee_id = selfId || req.body.employee_id;
  const { type_id, date_from, date_to, reason } = req.body;

  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });
  if (!type_id) return res.status(400).json({ error: 'Time off type is required' });
  if (!date_from || !date_to) return res.status(400).json({ error: 'Date from and date to are required' });
  if (date_to < date_from) return res.status(400).json({ error: 'Date to must be on or after date from' });

  let duration = req.body.duration !== undefined ? Number(req.body.duration) : daysBetween(date_from, date_to);
  if (isNaN(duration) || duration <= 0) {
    duration = daysBetween(date_from, date_to);
  }

  const type = await one('SELECT * FROM time_off_types WHERE id = $1', [type_id]);
  if (!type) return res.status(404).json({ error: 'Time off type not found' });

  // Guard: if allocation is required, check remaining balance
  if (type.requires_allocation) {
    const bal = await balanceFor(employee_id, type_id);
    if (bal.remaining < duration) {
      return res.status(400).json({
        error: `Insufficient ${type.name} balance: ${bal.remaining} ${type.unit}(s) remaining, ${duration} requested`,
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
  const newBalance = await balanceFor(employee_id, type_id);
  res.status(201).json({ data: { ...full, balance: newBalance } });
}));

requests.post('/:id/approve', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const r = await one(REQ_SQL + ' WHERE r.id = $1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });
  if (r.state === 'approved') return res.status(400).json({ error: 'Already approved' });

  if (r.requires_allocation) {
    const bal = await balanceFor(r.employee_id, r.type_id);
    if (bal.remaining < Number(r.duration)) {
      return res.status(400).json({
        error: `Insufficient ${r.type_name} balance: ${bal.remaining} ${r.unit}(s) remaining, ${r.duration} requested`,
        fields: { duration: ['Exceeds remaining allocation'] },
        remaining: bal.remaining,
      });
    }
  }

  await one(
    "UPDATE time_off_requests SET state='approved', approver_id=$1 WHERE id=$2 RETURNING id",
    [req.user?.id || null, r.id]
  );

  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [r.id]);
  const balance = await balanceFor(r.employee_id, r.type_id);
  res.json({ data: { ...full, balance } });
}));

requests.post('/:id/refuse', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const r = await one(REQ_SQL + ' WHERE r.id = $1', [req.params.id]);
  if (!r) return res.status(404).json({ error: 'Not found' });

  await one(
    "UPDATE time_off_requests SET state='refused', approver_id=$1 WHERE id=$2 RETURNING id",
    [req.user?.id || null, req.params.id]
  );

  const full = await one(`${REQ_SQL} WHERE r.id = $1`, [req.params.id]);
  const balance = await balanceFor(r.employee_id, r.type_id);
  res.json({ data: { ...full, balance } });
}));

requests.delete('/:id', can('timeoff_approve', 'write'), ah(async (req, res) => {
  await query('DELETE FROM time_off_requests WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

export const withDuration = (req, _res, next) => {
  if (req.body?.date_from && req.body?.date_to && !req.body.duration) {
    req.body.duration = daysBetween(req.body.date_from, req.body.date_to);
  }
  next();
};
