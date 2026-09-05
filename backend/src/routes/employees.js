/** Employees + departments + job positions (A1, B1, B2). Owner: Track A. */
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';
import { contractForPeriod } from '../lib/payroll.js';
import { employeeScopeFilter, canSeeEmployee } from '../lib/guards.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^(\+91[\s-]?)?[0-9]{10}$/;
const EMPLOYEE_TYPES = ['full_time', 'part_time', 'contract', 'intern'];
const EMPLOYEE_STATUSES = ['active', 'on_leave', 'inactive'];

/**
 * Field validation. Returns a problem object, or null when the body is fine.
 * `requireName` is false on PATCH, where a partial body is legitimate.
 */
function validateEmployee(body, requireName) {
  if (requireName && !String(body.name ?? '').trim()) {
    return { status: 400, error: 'Employee name is required' };
  }
  if (body.name !== undefined && !String(body.name ?? '').trim()) {
    return { status: 400, error: 'Employee name cannot be empty' };
  }
  if (body.work_email && !EMAIL_RE.test(String(body.work_email).trim())) {
    return { status: 400, error: `"${body.work_email}" is not a valid email address` };
  }
  if (body.phone && !PHONE_RE.test(String(body.phone).trim())) {
    return { status: 400, error: 'Phone number must be at least 10 digits (e.g. 9876543210 or +91 9876543210)' };
  }

  if (body.employee_type && !EMPLOYEE_TYPES.includes(body.employee_type)) {
    return { status: 400, error: `Employee type must be one of: ${EMPLOYEE_TYPES.join(', ')}` };
  }
  if (body.status && !EMPLOYEE_STATUSES.includes(body.status)) {
    return { status: 400, error: `Status must be one of: ${EMPLOYEE_STATUSES.join(', ')}` };
  }
  if (body.join_date && Number.isNaN(Date.parse(body.join_date))) {
    return { status: 400, error: 'Join date is not a valid date' };
  }
  return null;
}

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
  idColumn: 'e.id',
  filters: { department_id: 'e.department_id', status: 'e.status', employee_type: 'e.employee_type' },
  searchCol: 'e.name',
  orderBy: 'e.name ASC',
  hooks: {
    beforeCreate: (req) => validateEmployee(req.body, true),
    beforeUpdate: (req) => validateEmployee(req.body, false),
    /*
     * Drop CASCADE on employee deletion:
     * When HR/Admin deletes an employee, all their associated records
     * (payslips, payslip lines, contracts, attendance, time-off requests,
     * allocations) are deleted via CASCADE, and manager links are unlinked.
     */
    beforeDelete: async (req) => {
      // 1. Clear manager links on any direct reports
      await query('UPDATE employees SET manager_id = NULL WHERE manager_id = $1', [req.params.id]);

      // 2. Cascade delete payslip lines and payslips (including validated/paid ones)
      await query(`
        DELETE FROM payslip_jemil@jemil:~/Desktop/PeoplePay360$ git pull origin main
remote: Enumerating objects: 26, done.
remote: Counting objects: 100% (26/26), done.
remote: Compressing objects: 100% (2/2), done.
remote: Total 14 (delta 10), reused 14 (delta 10), pack-reused 0 (from 0)
Unpacking objects: 100% (14/14), 1.78 KiB | 456.00 KiB/s, done.
From https://github.com/ManPatel8032/PeoplePay360
 * branch            main       -> FETCH_HEAD
   b12cc83..9eef9fe  main       -> origin/main
hint: You have divergent branches and need to specify how to reconcile them.
hint: You can do so by running one of the following commands sometime before
hint: your next pull:
hint:
hint:   git config pull.rebase false  # merge
hint:   git config pull.rebase true   # rebase
hint:   git config pull.ff only       # fast-forward only
hint:
hint: You can replace "git config" with "git config --global" to set a default
hint: preference for all repositories. You can also pass --rebase, --no-rebase,
hint: or --ff-only on the command line to override the configured default per
hint: invocation.
fatal: Need to specify how to reconcile divergent branches.
jemil@jemil:~/Desktop/PeoplePay360$ ^C
jemil@jemil:~/Desktop/PeoplePay360$ git config pull.rebase false 
jemil@jemil:~/Desktop/PeoplePay360$ git push origin main
To https://github.com/ManPatel8032/PeoplePay360.git
 ! [rejected]        main -> main (non-fast-forward)
error: failed to push some refs to 'https://github.com/ManPatel8032/PeoplePay360.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. If you want to integrate the remote changes,
hint: use 'git pull' before pushing again.
hint: See the 'Note about fast-forwards' in 'git push --help' for details.lines
         WHERE payslip_id IN (SELECT id FROM payslips WHERE employee_id = $1)
      `, [req.params.id]);
      await query('DELETE FROM payslips WHERE employee_id = $1', [req.params.id]);

      // 3. Cascade delete contracts
      await query('DELETE FROM contracts WHERE employee_id = $1', [req.params.id]);

      // 4. Cascade delete attendance, time off requests, allocations
      await query('DELETE FROM attendance WHERE employee_id = $1', [req.params.id]);
      await query('DELETE FROM time_off_requests WHERE employee_id = $1', [req.params.id]);
      await query('DELETE FROM allocations WHERE employee_id = $1', [req.params.id]);

      // 5. Unlink user account if associated
      await query('UPDATE users SET employee_id = NULL WHERE employee_id = $1', [req.params.id]);

      return null;
    },
  },
  // A manager sees their own record plus everyone below them in the chart;
  // an individual contributor sees only themselves.
  scope: {
    filter: (req, params) => employeeScopeFilter(req, 'e.id', params),
    canSee: (req, row) => canSeeEmployee(req, row.id),
  },
});

/** Smart-button counts + live leave balances for the employee form (B2). */
employees.get('/:id/summary', can('employees', 'read'), ah(async (req, res) => {
  const id = req.params.id;
  if (!(await canSeeEmployee(req, id))) {
    return res.status(403).json({ error: 'This record is outside your team' });
  }
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
      contracts: await count('contracts'),
      attendance: await count('attendance'),
      time_off: await count('time_off_requests'),
      allocations: await count('allocations'),
      payslips: await count('payslips'),
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
