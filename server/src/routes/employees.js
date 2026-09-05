/** Employees + departments + job positions (A1, B1, B2). Owner: Track A. */
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';
import { contractForPeriod } from '../lib/payroll.js';

const EMP_SQL = `
  SELECT e.*, d.name AS department_name, j.name AS job_position_name,
         m.name AS manager_name, w.name AS schedule_name
    FROM employees e
    LEFT JOIN departments d ON d.id = e.department_id
    LEFT JOIN job_positions j ON j.id = e.job_position_id
    LEFT JOIN employees m ON m.id = e.manager_id
    LEFT JOIN working_schedules w ON w.id = e.schedule_id`;

export const employees = crudRouter({
  table: 'employees',
  module: 'employees',
  columns: ['name', 'work_email', 'phone', 'department_id', 'job_position_id', 'manager_id',
            'schedule_id', 'employee_type', 'status', 'bank_account', 'join_date'],
  listSql: EMP_SQL,
  itemSql: EMP_SQL,
  filters: { department_id: 'e.department_id', status: 'e.status', employee_type: 'e.employee_type' },
  searchCol: 'e.name',
  orderBy: 'e.name ASC',
});

/** Smart-button counts + live leave balances for the employee form (B2). */
employees.get('/:id/summary', can('employees', 'read'), ah(async (req, res) => {
  const id = req.params.id;
  const today = new Date().toISOString().slice(0, 10);
  const count = async (t) => (await one(`SELECT COUNT(*)::int n FROM ${t} WHERE employee_id = $1`, [id])).n;

  const balances = await query(
    `SELECT t.id AS type_id, t.name AS type_name, t.unit,
            COALESCE((SELECT SUM(a.amount) FROM allocations a
                       WHERE a.employee_id = $1 AND a.type_id = t.id AND a.state = 'approved'), 0) AS allocated,
            COALESCE((SELECT SUM(r.duration) FROM time_off_requests r
                       WHERE r.employee_id = $1 AND r.type_id = t.id AND r.state = 'approved'), 0) AS taken
       FROM time_off_types t ORDER BY t.name`,
    [id]
  );

  res.json({
    data: {
      contracts:   await count('contracts'),
      attendance:  await count('attendance'),
      time_off:    await count('time_off_requests'),
      allocations: await count('allocations'),
      payslips:    await count('payslips'),
      active_contract: await contractForPeriod(id, today, today),
      balances: balances.map((b) => ({ ...b, remaining: Number(b.allocated) - Number(b.taken) })),
    },
  });
}));


export const departments = crudRouter({
  table: 'departments', module: 'employees', columns: ['name'], orderBy: 'name',
});

export const positions = crudRouter({
  table: 'job_positions', module: 'employees', columns: ['name', 'department_id'], orderBy: 'name',
  filters: { department_id: 'job_positions.department_id' },
});
