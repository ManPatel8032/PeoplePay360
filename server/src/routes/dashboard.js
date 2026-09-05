/**
 * Payroll Dashboard (B9). Every number here is aggregated live from the
 * operational tables — nothing is precomputed or hardcoded.
 * Filters: period_start, period_end, department_id, employee_type.
 */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { ah } from '../lib/crud.js';

const router = Router();

router.get('/', can('dashboard', 'read'), ah(async (req, res) => {
  const today = new Date();
  const period_start = req.query.period_start || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 5, 1)).toISOString().slice(0, 10);
  const period_end = req.query.period_end || new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const dept = req.query.department_id || null;
  const etype = req.query.employee_type || null;

  // Employee filter shared by every block below.
  const empFilter = `($3::int IS NULL OR e.department_id = $3) AND ($4::text IS NULL OR e.employee_type = $4)`;
  const p = [period_start, period_end, dept, etype];

  const kpi = await one(
    `SELECT
       COALESCE(SUM(ps.net),0)                       AS total_net,
       COALESCE(SUM(ps.gross),0)                     AS total_gross,
       COUNT(ps.id)::int                             AS payslip_count,
       COALESCE(AVG(NULLIF(ps.net,0)),0)             AS avg_salary,
       COUNT(*) FILTER (WHERE ps.state='paid')::int  AS paid_count,
       COUNT(*) FILTER (WHERE ps.state='draft')::int AS draft_count
     FROM payslips ps JOIN employees e ON e.id = ps.employee_id
     WHERE ps.period_start >= $1 AND ps.period_end <= $2 AND ${empFilter}`, p
  );

  const headcount = await one(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e.status='active')::int AS active,
            COUNT(*) FILTER (WHERE e.status='on_leave')::int AS on_leave
       FROM employees e WHERE ($1::int IS NULL OR e.department_id=$1) AND ($2::text IS NULL OR e.employee_type=$2)`,
    [dept, etype]
  );

  // Salary cost by department
  const byDepartment = await query(
    `SELECT COALESCE(d.name,'Unassigned') AS department,
            COUNT(DISTINCT e.id)::int     AS headcount,
            COALESCE(SUM(ps.net),0)       AS net,
            COALESCE(SUM(ps.gross),0)     AS gross
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN payslips ps ON ps.employee_id = e.id
            AND ps.period_start >= $1 AND ps.period_end <= $2
      WHERE ${empFilter}
      GROUP BY d.name ORDER BY net DESC`, p
  );

  // Monthly net salary trend
  const trend = await query(
    `SELECT to_char(date_trunc('month', ps.period_start), 'YYYY-MM') AS month,
            COALESCE(SUM(ps.net),0) AS net, COUNT(*)::int AS payslips
       FROM payslips ps JOIN employees e ON e.id = ps.employee_id
      WHERE ps.period_start >= $1 AND ps.period_end <= $2 AND ${empFilter}
      GROUP BY 1 ORDER BY 1`, p
  );

  // Attendance quality
  const attendance = await one(
    `SELECT COUNT(*)::int                                            AS records,
            COUNT(*) FILTER (WHERE a.status='present')::int          AS present,
            COUNT(*) FILTER (WHERE a.status='late')::int             AS late,
            COUNT(*) FILTER (WHERE a.status='absent')::int           AS absent,
            COUNT(*) FILTER (WHERE a.status='overtime')::int         AS overtime,
            COUNT(*) FILTER (WHERE a.check_out IS NULL)::int         AS missing_checkout,
            COUNT(*) FILTER (WHERE a.manual_edit)::int               AS manual_edits,
            COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (a.check_out - a.check_in))/3600)::numeric,2),0) AS avg_hours
       FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.check_in::date BETWEEN $1 AND $2 AND ${empFilter}`, p
  );

  // Time off
  const timeOff = await one(
    `SELECT COALESCE(SUM(r.duration) FILTER (WHERE r.state='approved'),0) AS approved_days,
            COUNT(*) FILTER (WHERE r.state='to_approve')::int             AS pending_requests,
            COUNT(*) FILTER (WHERE r.state='refused')::int                AS refused_requests
       FROM time_off_requests r JOIN employees e ON e.id = r.employee_id
      WHERE r.date_from <= $2 AND r.date_to >= $1 AND ${empFilter}`, p
  );

  const leaveByType = await query(
    `SELECT t.name AS type, COALESCE(SUM(r.duration) FILTER (WHERE r.state='approved'),0) AS days,
            COUNT(*) FILTER (WHERE r.state='to_approve')::int AS pending
       FROM time_off_types t
       LEFT JOIN time_off_requests r ON r.type_id = t.id AND r.date_from <= $2 AND r.date_to >= $1
       LEFT JOIN employees e ON e.id = r.employee_id
      WHERE r.id IS NULL OR ${empFilter}
      GROUP BY t.name ORDER BY days DESC`, p
  );

  // Operational alerts — the live version of B9's "alerts" panel
  const alerts = [];
  const noBank = await one(
    `SELECT COUNT(*)::int n FROM employees e
      WHERE e.bank_account IS NULL AND e.status <> 'inactive'
        AND ($1::int IS NULL OR e.department_id = $1)
        AND ($2::text IS NULL OR e.employee_type = $2)`,
    [dept, etype]
  );
  if (noBank.n) alerts.push({ level: 'error', message: `${noBank.n} employee(s) missing bank details`, link: '/employees' });

  const noContract = await one(
    `SELECT COUNT(*)::int n FROM employees e
      WHERE e.status='active'
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.employee_id=e.id AND c.state='running'
                          AND c.start_date <= $2 AND (c.end_date IS NULL OR c.end_date >= $1))
        AND ${empFilter}`, p
  );
  if (noContract.n) alerts.push({ level: 'error', message: `${noContract.n} active employee(s) without a contract for this period`, link: '/contracts' });

  const expiring = await one(
    `SELECT COUNT(*)::int n FROM contracts c JOIN employees e ON e.id=c.employee_id
      WHERE c.state='running' AND c.end_date IS NOT NULL AND c.end_date BETWEEN $1 AND $2 AND ${empFilter}`, p
  );
  if (expiring.n) alerts.push({ level: 'warning', message: `${expiring.n} contract(s) expiring in this period`, link: '/contracts' });

  const dupes = await query(
    `SELECT e.name, ps.period_start, COUNT(*)::int n
       FROM payslips ps JOIN employees e ON e.id = ps.employee_id
      WHERE ps.state <> 'cancelled' AND ps.period_start >= $1 AND ps.period_end <= $2 AND ${empFilter}
      GROUP BY e.name, ps.period_start HAVING COUNT(*) > 1`, p
  );
  for (const d of dupes)
    alerts.push({ level: 'error', message: `Duplicate payslips for ${d.name} (${d.period_start}) — ${d.n} found`, link: '/payslips' });

  if (Number(timeOff.pending_requests)) alerts.push({ level: 'info', message: `${timeOff.pending_requests} time off request(s) awaiting approval`, link: '/time-off/requests' });
  if (Number(attendance.missing_checkout)) alerts.push({ level: 'warning', message: `${attendance.missing_checkout} attendance record(s) missing check-out`, link: '/attendance' });
  if (Number(kpi.draft_count)) alerts.push({ level: 'info', message: `${kpi.draft_count} payslip(s) still in draft`, link: '/payruns' });

  const records = Number(attendance.records) || 0;
  const attendanceHealth = records
    ? Math.round(((Number(attendance.present) + Number(attendance.overtime)) / records) * 100)
    : 0;

  res.json({
    data: {
      filters: { period_start, period_end, department_id: dept, employee_type: etype },
      kpi: {
        total_net: Number(kpi.total_net),
        total_gross: Number(kpi.total_gross),
        payslip_count: kpi.payslip_count,
        avg_salary: Math.round(Number(kpi.avg_salary)),
        paid_count: kpi.paid_count,
        headcount: headcount.total,
        active_headcount: headcount.active,
        approved_time_off: Number(timeOff.approved_days),
        pending_requests: timeOff.pending_requests,
        attendance_health: attendanceHealth,
      },
      by_department: byDepartment,
      trend,
      attendance,
      time_off: { ...timeOff, by_type: leaveByType },
      alerts,
    },
  });
}));

export default router;
