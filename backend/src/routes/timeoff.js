/** Time Off: types, allocations, requests + approval workflow (A4, B4). */
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';
import { daysBetween } from '../lib/dates.js';

export const types = crudRouter({
  table: 'time_off_types',
  module: 'timeoff',
  columns: ['name', 'code', 'unit', 'requires_allocation', 'requires_approval', 'is_paid', 'color'],
  orderBy: 'name',
});

const ALLOC_SQL = `
  SELECT a.*, e.name AS employee_name, t.name AS type_name, t.unit
    FROM allocations a
    JOIN employees e ON e.id = a.employee_id
    JOIN time_off_types t ON t.id = a.type_id`;

export const allocations = crudRouter({
  table: 'allocations',
  module: 'allocations',
  columns: ['employee_id', 'type_id', 'amount', 'state', 'valid_from', 'valid_to', 'note'],
  listSql: ALLOC_SQL,
  itemSql: ALLOC_SQL,
  filters: { employee_id: 'a.employee_id', type_id: 'a.type_id', state: 'a.state' },
  searchCol: 'e.name',
  orderBy: 'a.valid_from DESC',
});

/** An allocation only counts toward a balance once approved (A4). */
allocations.post('/:id/approve', can('allocations', 'write'), ah(async (req, res) => {
  const row = await one("UPDATE allocations SET state='approved' WHERE id=$1 RETURNING *", [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: row });
}));

allocations.post('/:id/refuse', can('allocations', 'write'), ah(async (req, res) => {
  const row = await one("UPDATE allocations SET state='refused' WHERE id=$1 RETURNING *", [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: row });
}));

const REQ_SQL = `
  SELECT r.*, e.name AS employee_name, d.name AS department_name,
         t.name AS type_name, t.unit, t.requires_allocation, t.is_paid
    FROM time_off_requests r
    JOIN employees e ON e.id = r.employee_id
    JOIN time_off_types t ON t.id = r.type_id
    LEFT JOIN departments d ON d.id = e.department_id`;

export const requests = crudRouter({
  table: 'time_off_requests',
  module: 'timeoff',
  columns: ['employee_id', 'type_id', 'date_from', 'date_to', 'duration', 'state', 'reason'],
  listSql: REQ_SQL,
  itemSql: REQ_SQL,
  filters: { employee_id: 'r.employee_id', state: 'r.state', type_id: 'r.type_id' },
  searchCol: 'e.name',
  orderBy: 'r.date_from DESC',
});

/** Live balance: approved allocations minus approved requests. */
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

requests.get('/balances/:employeeId', can('timeoff', 'read'), ah(async (req, res) => {
  const types = await query('SELECT * FROM time_off_types ORDER BY name');
  const data = [];
  for (const t of types) {
    data.push({
      type_id: t.id, type_name: t.name, unit: t.unit,
      requires_allocation: t.requires_allocation,
      ...(await balanceFor(req.params.employeeId, t.id)),
    });
  }
  res.json({ data });
}));

/** Approve — refuses when the type needs an allocation and the balance is short (A4). */
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
      });
    }
  }
  const row = await one(
    "UPDATE time_off_requests SET state='approved', approver_id=$1 WHERE id=$2 RETURNING *",
    [req.user.id, r.id]
  );
  res.json({ data: { ...row, balance: await balanceFor(r.employee_id, r.type_id) } });
}));

requests.post('/:id/refuse', can('timeoff_approve', 'write'), ah(async (req, res) => {
  const row = await one(
    "UPDATE time_off_requests SET state='refused', approver_id=$1 WHERE id=$2 RETURNING *",
    [req.user.id, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ data: row });
}));

/** Duration defaults to the inclusive day span. Mounted ahead of the request router. */
export const withDuration = (req, _res, next) => {
  if (req.body?.date_from && req.body?.date_to && !req.body.duration) {
    req.body.duration = daysBetween(req.body.date_from, req.body.date_to);
  }
  next();
};
