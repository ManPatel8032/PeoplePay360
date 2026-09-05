/** Attendance (B3). Owner: Track B. */
import { one } from '../db.js';
import { can } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';
import { hoursBetween } from '../lib/dates.js';

// ---------- Attendance (B3) ----------
const ATT_SQL = `
  SELECT a.*, e.name AS employee_name, d.name AS department_name,
         ROUND(EXTRACT(EPOCH FROM (a.check_out - a.check_in))::numeric / 3600, 2) AS worked_hours
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id`;

export const attendance = crudRouter({
  table: 'attendance',
  module: 'attendance',
  columns: ['employee_id', 'check_in', 'check_out', 'status', 'manual_edit', 'notes'],
  listSql: ATT_SQL,
  itemSql: ATT_SQL,
  filters: { employee_id: 'a.employee_id', status: 'a.status' },
  searchCol: 'e.name',
  orderBy: 'a.check_in DESC',
});

/** Check-out closes the open record and derives the status. */
attendance.post('/:id/check-out', can('attendance', 'write'), ah(async (req, res) => {
  const at = req.body.check_out || new Date().toISOString();
  const row = await one('SELECT * FROM attendance WHERE id = $1', [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.check_out) return res.status(400).json({ error: 'Already checked out' });
  const h = hoursBetween(row.check_in, at);
  const status = h > 9 ? 'overtime' : h < 4 ? 'half_day' : row.status;
  const updated = await one(
    'UPDATE attendance SET check_out=$1, status=$2, manual_edit=TRUE WHERE id=$3 RETURNING *',
    [at, status, row.id]
  );
  res.json({ data: updated });
}));

