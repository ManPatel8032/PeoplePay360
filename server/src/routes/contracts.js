/** Contracts (A2). Owner: Track A. */
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';

const CONTRACT_SQL = `
  SELECT c.*, e.name AS employee_name, d.name AS department_name,
         j.name AS job_position_name, s.name AS structure_name, w.name AS schedule_name
    FROM contracts c
    JOIN employees e ON e.id = c.employee_id
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN job_positions j ON j.id = c.job_position_id
    LEFT JOIN salary_structures s ON s.id = c.structure_id
    LEFT JOIN working_schedules w ON w.id = c.schedule_id`;

export const contracts = crudRouter({
  table: 'contracts',
  module: 'contracts',
  columns: ['employee_id', 'name', 'start_date', 'end_date', 'department_id', 'job_position_id',
            'schedule_id', 'wage', 'structure_id', 'state'],
  listSql: CONTRACT_SQL,
  itemSql: CONTRACT_SQL,
  filters: { employee_id: 'c.employee_id', state: 'c.state' },
  searchCol: 'c.name',
  orderBy: 'c.start_date DESC',
});

/**
 * A contract is only "active" if no other running contract overlaps it.
 * Guarding here is what stops payroll picking an ambiguous contract later (A2).
 */
contracts.post('/:id/check-overlap', can('contracts', 'read'), ah(async (req, res) => {
  const c = await one('SELECT * FROM contracts WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const others = await query(
    `SELECT * FROM contracts
      WHERE employee_id = $1 AND id <> $2 AND state = 'running'
        AND start_date <= COALESCE($3, DATE '9999-12-31')
        AND (end_date IS NULL OR end_date >= $4)`,
    [c.employee_id, c.id, c.end_date, c.start_date]
  );
  res.json({ data: { overlapping: others } });
}));

