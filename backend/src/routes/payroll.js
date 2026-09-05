/** Salary structures & rules, Payrun wizard, Payslips, PDF, bulk email (A5, A6, B5-B8). */
import { Router } from 'express';
import { query, one, tx } from '../db.js';
import { can, scopeToSelf } from '../auth.js';
import { crudRouter, ah } from '../lib/crud.js';
import { computePayslip, getPayslip, contractForPeriod, periodStats, collectWarnings } from '../lib/payroll.js';
import { renderPayslipPdf } from '../lib/pdf.js';
import { sendPayslipMail } from '../lib/mail.js';

// ---------- Salary structures (A5) ----------
const STRUCT_SQL = `
  SELECT s.*,
         (SELECT COUNT(*)::int FROM salary_rules r WHERE r.structure_id = s.id) AS rule_count,
         (SELECT COUNT(*)::int FROM contracts c WHERE c.structure_id = s.id AND c.state='running') AS employee_count
    FROM salary_structures s`;

export const structures = crudRouter({
  table: 'salary_structures',
  module: 'structures',
  columns: ['name', 'code', 'active'],
  listSql: STRUCT_SQL,
  itemSql: STRUCT_SQL,
  filters: { active: 's.active' },
  searchCol: 's.name',
  orderBy: 's.name',
});

structures.get('/:id/rules', can('rules', 'read'), ah(async (req, res) => {
  const data = await query(
    'SELECT * FROM salary_rules WHERE structure_id = $1 ORDER BY sequence, id', [req.params.id]
  );
  res.json({ data });
}));

// ---------- Salary rules (A6) ----------
export const rules = crudRouter({
  table: 'salary_rules',
  module: 'rules',
  columns: ['structure_id', 'name', 'code', 'category', 'sequence', 'compute_type',
            'amount', 'percent_base', 'formula', 'active'],
  listSql: `SELECT r.*, s.name AS structure_name FROM salary_rules r
              JOIN salary_structures s ON s.id = r.structure_id`,
  itemSql: `SELECT r.*, s.name AS structure_name FROM salary_rules r
              JOIN salary_structures s ON s.id = r.structure_id`,
  filters: { structure_id: 'r.structure_id', category: 'r.category' },
  searchCol: 'r.name',
  orderBy: 'r.sequence, r.id',
});

/** Guard: duplicate rule code within the same structure → 400, not a raw DB error. */
rules.post('/', can('rules', 'write'), ah(async (req, res, next) => {
  if (req.body.code && req.body.structure_id) {
    const dup = await one(
      'SELECT id FROM salary_rules WHERE structure_id = $1 AND code = $2',
      [req.body.structure_id, req.body.code]
    );
    if (dup) return res.status(400).json({ error: `Rule code '${req.body.code}' already exists in this structure` });
  }
  next();
}));

/** Dry-run a rule set against a sample context so config screens are not blind. */
rules.post('/preview', can('rules', 'read'), ah(async (req, res) => {
  const { structure_id, employee_id, period_start, period_end } = req.body;
  const employee = await one('SELECT * FROM employees WHERE id = $1', [employee_id]);
  if (!employee) return res.status(400).json({ error: 'Pick an employee to preview against' });
  const contract = await contractForPeriod(employee_id, period_start, period_end);
  const stats = await periodStats(employee, contract, period_start, period_end);
  const { computeRules } = await import('../lib/payroll.js');
  const result = await computeRules(structure_id, {
    wage: Number(contract?.wage) || 0,
    worked_days: stats.workedDays, working_days: stats.workingDays,
    attended_days: stats.attendedDays, attendance_hours: stats.attendanceHours,
    overtime_hours: stats.overtimeHours, paid_leave_days: stats.paidLeaveDays,
    unpaid_leave_days: stats.unpaidLeaveDays, leave_days: stats.leaveDays, late_days: stats.lateDays,
  });
  res.json({ data: { ...result, stats, contract } });
}));

// ---------- Payruns (B5, B6) ----------
const PAYRUN_SQL = `
  SELECT p.*, s.name AS structure_name, d.name AS department_name,
         (SELECT COUNT(*)::int FROM payslips ps WHERE ps.payrun_id = p.id) AS payslip_count,
         (SELECT COALESCE(SUM(ps.net),0) FROM payslips ps WHERE ps.payrun_id = p.id) AS total_net
    FROM payruns p
    JOIN salary_structures s ON s.id = p.structure_id
    LEFT JOIN departments d ON d.id = p.department_id`;

export const payruns = crudRouter({
  table: 'payruns',
  module: 'payruns',
  columns: ['name', 'structure_id', 'period_start', 'period_end', 'department_id', 'state'],
  listSql: PAYRUN_SQL,
  itemSql: PAYRUN_SQL,
  filters: { state: 'p.state', structure_id: 'p.structure_id', department_id: 'p.department_id' },
  searchCol: 'p.name',
  orderBy: 'p.period_start DESC, p.id DESC',
});

/** Immutability guard: validated/paid payruns cannot be modified or deleted. */
payruns.patch('/:id', can('payruns', 'write'), ah(async (req, res, next) => {
  const run = await one('SELECT state FROM payruns WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (['validated', 'paid'].includes(run.state))
    return res.status(400).json({ error: `Cannot modify a ${run.state} payrun — it is a historical record` });
  next();
}));
payruns.delete('/:id', can('payruns', 'write'), ah(async (req, res, next) => {
  const run = await one('SELECT state FROM payruns WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (['validated', 'paid'].includes(run.state))
    return res.status(400).json({ error: `Cannot delete a ${run.state} payrun — it is a historical record` });
  next();
}));

/**
 * Wizard step 2: eligible employees for the chosen scope + period.
 * Nothing is created yet — the wizard only creates on "Create Payrun" (B5).
 */
payruns.post('/eligible', can('payruns', 'read'), ah(async (req, res) => {
  const { period_start, period_end, department_id, employee_type } = req.body;
  const params = [period_end, period_start];
  let filter = '';
  if (department_id) { params.push(department_id); filter += ` AND e.department_id = $${params.length}`; }
  if (employee_type) { params.push(employee_type); filter += ` AND e.employee_type = $${params.length}`; }

  const rows = await query(
    `SELECT e.id, e.name, e.employee_type, e.bank_account, d.name AS department_name,
            c.id AS contract_id, c.name AS contract_name, c.wage, c.end_date AS contract_end,
            (SELECT COUNT(*)::int FROM payslips ps
              WHERE ps.employee_id = e.id AND ps.period_start = $2 AND ps.period_end = $1
                AND ps.state <> 'cancelled') AS existing_payslips
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN LATERAL (
            SELECT * FROM contracts c2
             WHERE c2.employee_id = e.id AND c2.state IN ('running','expired')
               AND c2.start_date <= $1 AND (c2.end_date IS NULL OR c2.end_date >= $2)
             ORDER BY c2.start_date DESC LIMIT 1
       ) c ON TRUE
      WHERE e.status <> 'inactive' ${filter}
      ORDER BY e.name`,
    params
  );

  res.json({
    data: rows.map((r) => ({
      ...r,
      eligible: !!r.contract_id,
      blockers: [
        !r.contract_id && 'No contract for this period',
        !r.bank_account && 'Missing bank details',
        r.existing_payslips > 0 && 'Payslip already exists for this period',
      ].filter(Boolean),
    })),
  });
}));

/** Wizard "Create Payrun": creates the batch with only the selected employees (B5). */
payruns.post('/wizard', can('payruns', 'write'), ah(async (req, res) => {
  const { name, structure_id, period_start, period_end, department_id, employee_ids = [] } = req.body;
  if (!structure_id || !period_start || !period_end)
    return res.status(400).json({ error: 'Structure and period are required' });
  if (!employee_ids.length)
    return res.status(400).json({ error: 'Select at least one employee' });

  const payrunId = await tx(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO payruns (name, structure_id, period_start, period_end, department_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name || `Payrun ${period_start} → ${period_end}`, structure_id, period_start, period_end, department_id || null]
    );
    const id = rows[0].id;
    for (const empId of employee_ids) {
      await c.query(
        `INSERT INTO payslips (payrun_id, employee_id, period_start, period_end, structure_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (payrun_id, employee_id) DO NOTHING`,
        [id, empId, period_start, period_end, structure_id]
      );
    }
    return id;
  });

  res.status(201).json({ data: await payrunDetail(payrunId) });
}));

async function payrunDetail(id) {
  const run = await one(PAYRUN_SQL + ' WHERE p.id = $1', [id]);
  if (!run) return null;
  run.payslips = await query(
    `SELECT ps.*, e.name AS employee_name, e.bank_account, d.name AS department_name
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
      WHERE ps.payrun_id = $1 ORDER BY e.name`,
    [id]
  );
  run.warning_count = run.payslips.reduce(
    (n, p) => n + (p.warnings || []).filter((w) => w.level === 'error').length, 0
  );
  return run;
}

payruns.get('/:id/detail', can('payruns', 'read'), ah(async (req, res) => {
  const data = await payrunDetail(req.params.id);
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ data });
}));

/** Compute every payslip in the run (B6). */
payruns.post('/:id/compute', can('payruns', 'write'), ah(async (req, res) => {
  const run = await one('SELECT * FROM payruns WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (['validated', 'paid'].includes(run.state))
    return res.status(400).json({ error: `Cannot compute a ${run.state} payrun` });

  const slips = await query('SELECT id FROM payslips WHERE payrun_id = $1', [run.id]);
  for (const s of slips) await computePayslip(s.id);
  await query("UPDATE payruns SET state='computed' WHERE id=$1", [run.id]);
  res.json({ data: await payrunDetail(run.id) });
}));

/** Validate — blocked while any payslip still carries an error-level warning (B6). */
payruns.post('/:id/validate', can('payruns', 'write'), ah(async (req, res) => {
  const run = await payrunDetail(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (run.state === 'draft') return res.status(400).json({ error: 'Compute the payrun first' });
  if (['validated', 'paid'].includes(run.state))
    return res.status(400).json({ error: `Payrun is already ${run.state}` });

  const blocking = run.payslips.flatMap((p) =>
    (p.warnings || []).filter((w) => w.level === 'error').map((w) => `${p.employee_name}: ${w.message}`)
  );
  if (blocking.length && !req.body.force)
    return res.status(400).json({ error: 'Resolve blocking warnings before validating', blockers: blocking });

  await tx(async (c) => {
    await c.query("UPDATE payslips SET state='validated' WHERE payrun_id=$1 AND state<>'cancelled'", [run.id]);
    await c.query("UPDATE payruns SET state='validated' WHERE id=$1", [run.id]);
  });
  res.json({ data: await payrunDetail(run.id) });
}));

payruns.post('/:id/mark-paid', can('payruns', 'write'), ah(async (req, res) => {
  const run = await one('SELECT * FROM payruns WHERE id = $1', [req.params.id]);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (run.state !== 'validated') return res.status(400).json({ error: 'Validate the payrun first' });
  await tx(async (c) => {
    await c.query("UPDATE payslips SET state='paid' WHERE payrun_id=$1 AND state='validated'", [run.id]);
    await c.query("UPDATE payruns SET state='paid' WHERE id=$1", [run.id]);
  });
  res.json({ data: await payrunDetail(run.id) });
}));

/** Bulk payslip email (B8). */
payruns.post('/:id/send-payslips', can('payruns', 'write'), ah(async (req, res) => {
  const run = await payrunDetail(req.params.id);
  if (!run) return res.status(404).json({ error: 'Not found' });
  if (!['validated', 'paid'].includes(run.state))
    return res.status(400).json({ error: 'Validate the payrun before sending payslips' });

  const results = [];
  for (const p of run.payslips) {
    const slip = await getPayslip(p.id);
    if (!slip.work_email) { results.push({ payslip_id: p.id, employee: slip.employee_name, ok: false, reason: 'No work email' }); continue; }
    try {
      const pdf = await renderPayslipPdf(slip);
      const info = await sendPayslipMail(slip, pdf);
      await query('UPDATE payslips SET sent_at = now() WHERE id = $1', [p.id]);
      results.push({ payslip_id: p.id, employee: slip.employee_name, ok: true, ...info });
    } catch (err) {
      results.push({ payslip_id: p.id, employee: slip.employee_name, ok: false, reason: err.message });
    }
  }
  res.json({ data: { sent: results.filter((r) => r.ok).length, total: results.length, results } });
}));

// ---------- Payslips (B7, B8) ----------
export const payslips = Router();

/** Helper: enforce employee-only access to own payslips. */
function enforceSelfScope(req, slip) {
  const selfId = scopeToSelf(req);
  if (selfId && slip.employee_id !== selfId) return false;
  return true;
}

payslips.get('/', can('payslips', 'read'), ah(async (req, res) => {
  const params = [];
  const where = [];

  // Employee security: employees can ONLY see their own payslips
  const selfId = scopeToSelf(req);
  if (selfId) {
    params.push(selfId);
    where.push(`ps.employee_id = $${params.length}`);
  }

  for (const [q, col] of Object.entries({ payrun_id: 'ps.payrun_id', employee_id: 'ps.employee_id', state: 'ps.state' })) {
    if (req.query[q]) { params.push(req.query[q]); where.push(`${col} = $${params.length}`); }
  }
  const data = await query(
    `SELECT ps.*, e.name AS employee_name, d.name AS department_name,
            r.name AS payrun_name, s.name AS structure_name
       FROM payslips ps
       JOIN employees e ON e.id = ps.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN payruns r ON r.id = ps.payrun_id
       LEFT JOIN salary_structures s ON s.id = ps.structure_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY ps.period_start DESC, e.name`,
    params
  );
  res.json({ data });
}));

payslips.get('/:id', can('payslips', 'read'), ah(async (req, res) => {
  const data = await getPayslip(req.params.id);
  if (!data) return res.status(404).json({ error: 'Not found' });
  if (!enforceSelfScope(req, data))
    return res.status(403).json({ error: 'You can only view your own payslips' });
  res.json({ data });
}));

payslips.post('/:id/compute', can('payslips', 'write'), ah(async (req, res) => {
  res.json({ data: await computePayslip(req.params.id) });
}));

payslips.get('/:id/pdf', can('payslips', 'read'), ah(async (req, res) => {
  const slip = await getPayslip(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Not found' });
  if (!enforceSelfScope(req, slip))
    return res.status(403).json({ error: 'You can only download your own payslip' });
  const pdf = await renderPayslipPdf(slip);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition',
    `inline; filename="payslip-${slip.employee_name.replace(/\W+/g, '-')}-${slip.period_start}.pdf"`);
  res.send(pdf);
}));

payslips.post('/:id/send', can('payslips', 'write'), ah(async (req, res) => {
  const slip = await getPayslip(req.params.id);
  if (!slip) return res.status(404).json({ error: 'Not found' });
  if (!slip.work_email) return res.status(400).json({ error: 'Employee has no work email' });
  const info = await sendPayslipMail(slip, await renderPayslipPdf(slip));
  await query('UPDATE payslips SET sent_at = now() WHERE id = $1', [slip.id]);
  res.json({ data: info });
}));
