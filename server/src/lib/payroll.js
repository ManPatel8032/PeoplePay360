/**
 * Payroll engine.
 *
 * The two rules the problem statement cares most about:
 *  1. A payslip uses the ONE contract whose date range covers the payroll period.
 *  2. Salary rules run in `sequence` order; each rule can reference the result of
 *     any rule that already ran, by code (RULE.BASIC) or by category total (CAT.ALW).
 */
import { query, one, tx } from '../db.js';
import { scheduledDays, overlapDays, hoursBetween, daysBetween } from './dates.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Contract applicable to a period (A2): the contract whose [start_date, end_date]
 * overlaps the period. Latest start wins, so a renewal supersedes its predecessor.
 */
export function contractForPeriod(employeeId, periodStart, periodEnd) {
  return one(
    `SELECT * FROM contracts
      WHERE employee_id = $1
        AND state IN ('running','expired')
        AND start_date <= $2
        AND (end_date IS NULL OR end_date >= $3)
      ORDER BY start_date DESC LIMIT 1`,
    [employeeId, periodEnd, periodStart]
  );
}

/** Every running contract overlapping the period — used to detect concurrent contracts. */
export function overlappingContracts(employeeId, periodStart, periodEnd) {
  return query(
    `SELECT * FROM contracts
      WHERE employee_id = $1 AND state = 'running'
        AND start_date <= $2 AND (end_date IS NULL OR end_date >= $3)`,
    [employeeId, periodEnd, periodStart]
  );
}

/** Attendance + time off aggregated for the period. */
export async function periodStats(employee, contract, periodStart, periodEnd) {
  const scheduleId = contract?.schedule_id || employee.schedule_id;
  const lines = scheduleId
    ? await query('SELECT * FROM schedule_lines WHERE schedule_id = $1', [scheduleId])
    : [];

  const workingDays =
    scheduledDays(lines, periodStart, periodEnd) || daysBetween(periodStart, periodEnd);

  const att = await query(
    `SELECT * FROM attendance
      WHERE employee_id = $1 AND check_in::date BETWEEN $2 AND $3`,
    [employee.id, periodStart, periodEnd]
  );

  const attendedDays = new Set(att.map((a) => a.check_in.slice(0, 10))).size;
  const attendanceHours = att.reduce((s, a) => s + hoursBetween(a.check_in, a.check_out), 0);
  const missingCheckouts = att.filter((a) => !a.check_out).length;
  const lateDays = att.filter((a) => a.status === 'late').length;
  const manualEdits = att.filter((a) => a.manual_edit).length;
  const overtimeHours = att
    .filter((a) => a.status === 'overtime')
    .reduce((s, a) => s + Math.max(0, hoursBetween(a.check_in, a.check_out) - 8), 0);

  // approved leave overlapping the period, split paid vs unpaid (unpaid => LOP)
  const leaves = await query(
    `SELECT r.*, t.is_paid, t.name AS type_name
       FROM time_off_requests r JOIN time_off_types t ON t.id = r.type_id
      WHERE r.employee_id = $1 AND r.state = 'approved'
        AND r.date_from <= $2 AND r.date_to >= $3`,
    [employee.id, periodEnd, periodStart]
  );

  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  for (const l of leaves) {
    const d = overlapDays(periodStart, periodEnd, l.date_from, l.date_to);
    if (l.is_paid) paidLeaveDays += d;
    else unpaidLeaveDays += d;
  }

  const workedDays = Math.max(0, workingDays - unpaidLeaveDays);

  return {
    workingDays,
    workedDays,
    attendedDays,
    attendanceHours: round2(attendanceHours),
    overtimeHours: round2(overtimeHours),
    missingCheckouts,
    lateDays,
    manualEdits,
    paidLeaveDays,
    unpaidLeaveDays,
    leaveDays: paidLeaveDays + unpaidLeaveDays,
  };
}

/**
 * Run a structure's rules in sequence order.
 * Returns { lines, gross, net, categories }.
 */
export async function computeRules(structureId, ctx) {
  const rules = await query(
    'SELECT * FROM salary_rules WHERE structure_id = $1 AND active ORDER BY sequence ASC, id ASC',
    [structureId]
  );

  const byCode = {};                                   // RULE.BASIC -> amount
  const cat = { BASIC: 0, ALW: 0, GROSS: 0, DED: 0, NET: 0 };
  const lines = [];

  for (const rule of rules) {
    let amount = 0;
    try {
      if (rule.compute_type === 'fixed') {
        amount = Number(rule.amount) || 0;
      } else if (rule.compute_type === 'percent') {
        const base = byCode[rule.percent_base] ?? cat[rule.percent_base] ?? 0;
        amount = (base * (Number(rule.amount) || 0)) / 100;
      } else {
        amount = evalFormula(rule.formula, { ...ctx, RULE: byCode, CAT: cat });
      }
    } catch (err) {
      lines.push({
        rule_id: rule.id, code: rule.code, name: `${rule.name} — formula error`,
        category: rule.category, sequence: rule.sequence, amount: 0, error: err.message,
      });
      continue;
    }

    amount = round2(amount);
    byCode[rule.code] = amount;
    cat[rule.category] = round2((cat[rule.category] || 0) + amount);
    lines.push({
      rule_id: rule.id, code: rule.code, name: rule.name,
      category: rule.category, sequence: rule.sequence, amount,
    });
  }

  // GROSS / NET are normally explicit rules; fall back to derived totals if absent.
  const gross = cat.GROSS || round2(cat.BASIC + cat.ALW);
  const net = cat.NET || round2(gross - Math.abs(cat.DED));
  return { lines, gross, net, categories: cat };
}

/** Evaluate a rule formula against the payroll context. No access to globals. */
function evalFormula(formula, ctx) {
  if (!formula) return 0;
  const keys = Object.keys(ctx);
  // eslint-disable-next-line no-new-func
  const fn = new Function(...keys, 'Math', `"use strict"; return (${formula});`);
  const out = fn(...keys.map((k) => ctx[k]), Math);
  return Number.isFinite(out) ? out : 0;
}

/** Pre-flight checks surfaced before validation (technical guideline 4). */
export async function collectWarnings({ employee, contract, stats, payrunId, periodStart, periodEnd }) {
  const w = [];
  if (!contract) {
    w.push({ level: 'error', message: 'No contract covers this payroll period' });
  } else {
    if (!contract.structure_id) w.push({ level: 'warning', message: 'Contract has no salary structure assigned' });
    if (!Number(contract.wage)) w.push({ level: 'error', message: 'Contract wage is zero' });
    if (contract.end_date && contract.end_date <= periodEnd)
      w.push({ level: 'info', message: `Contract expires ${contract.end_date} — renewal needed` });
    const overlaps = await overlappingContracts(employee.id, periodStart, periodEnd);
    if (overlaps.length > 1)
      w.push({ level: 'error', message: `${overlaps.length} concurrent running contracts cover this period` });
  }
  if (!employee.bank_account) w.push({ level: 'error', message: 'Missing bank account details' });
  if (!employee.work_email) w.push({ level: 'warning', message: 'No work email — payslip cannot be emailed' });
  if (stats.missingCheckouts) w.push({ level: 'warning', message: `${stats.missingCheckouts} attendance record(s) missing check-out` });
  if (stats.unpaidLeaveDays) w.push({ level: 'info', message: `${stats.unpaidLeaveDays} unpaid leave day(s) deducted` });
  if (stats.attendedDays === 0) w.push({ level: 'warning', message: 'No attendance recorded in this period' });

  const dup = await one(
    `SELECT COUNT(*)::int AS n FROM payslips
      WHERE employee_id = $1 AND period_start = $2 AND period_end = $3
        AND payrun_id <> $4 AND state <> 'cancelled'`,
    [employee.id, periodStart, periodEnd, payrunId || 0]
  );
  if (dup.n > 0) w.push({ level: 'error', message: `Duplicate payslip: ${dup.n} other payslip(s) exist for this period` });

  return w;
}

/** Compute (or recompute) one payslip in place. */
export async function computePayslip(payslipId) {
  const slip = await one('SELECT * FROM payslips WHERE id = $1', [payslipId]);
  if (!slip) throw Object.assign(new Error('Payslip not found'), { status: 404 });
  if (['validated', 'paid'].includes(slip.state))
    throw Object.assign(new Error('Cannot recompute a validated or paid payslip'), { status: 400 });

  const employee = await one('SELECT * FROM employees WHERE id = $1', [slip.employee_id]);
  const payrun = await one('SELECT * FROM payruns WHERE id = $1', [slip.payrun_id]);

  const contract = await contractForPeriod(employee.id, slip.period_start, slip.period_end);
  const stats = await periodStats(employee, contract, slip.period_start, slip.period_end);

  // The Payrun's structure wins; the contract's structure is the fallback (B7).
  const structureId = payrun.structure_id || contract?.structure_id;

  const ctx = {
    wage: Number(contract?.wage) || 0,
    worked_days: stats.workedDays,
    working_days: stats.workingDays,
    attended_days: stats.attendedDays,
    attendance_hours: stats.attendanceHours,
    overtime_hours: stats.overtimeHours,
    paid_leave_days: stats.paidLeaveDays,
    unpaid_leave_days: stats.unpaidLeaveDays,
    leave_days: stats.leaveDays,
    late_days: stats.lateDays,
  };

  const { lines, gross, net } = structureId
    ? await computeRules(structureId, ctx)
    : { lines: [], gross: 0, net: 0 };

  const warnings = await collectWarnings({
    employee, contract, stats,
    payrunId: slip.payrun_id, periodStart: slip.period_start, periodEnd: slip.period_end,
  });

  await tx(async (c) => {
    await c.query('DELETE FROM payslip_lines WHERE payslip_id = $1', [slip.id]);
    for (const l of lines) {
      await c.query(
        `INSERT INTO payslip_lines (payslip_id, rule_id, code, name, category, sequence, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [slip.id, l.rule_id ?? null, l.code, l.name, l.category, l.sequence, l.amount]
      );
    }
    await c.query(
      `UPDATE payslips SET contract_id=$1, structure_id=$2, worked_days=$3, leave_days=$4,
                           gross=$5, net=$6, state='computed', warnings=$7::jsonb WHERE id=$8`,
      [contract?.id ?? null, structureId ?? null, stats.workedDays, stats.leaveDays,
       gross, net, JSON.stringify(warnings), slip.id]
    );
  });

  const out = await getPayslip(slip.id);
  out.stats = stats;
  return out;
}

export async function getPayslip(id) {
  const slip = await one(
    `SELECT p.*, e.name AS employee_name, e.work_email, e.bank_account,
            d.name AS department_name, s.name AS structure_name, r.name AS payrun_name
       FROM payslips p
       JOIN employees e ON e.id = p.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN salary_structures s ON s.id = p.structure_id
       LEFT JOIN payruns r ON r.id = p.payrun_id
      WHERE p.id = $1`,
    [id]
  );
  if (!slip) return null;
  slip.lines = await query('SELECT * FROM payslip_lines WHERE payslip_id = $1 ORDER BY sequence, id', [id]);
  slip.contract = slip.contract_id
    ? await one('SELECT * FROM contracts WHERE id = $1', [slip.contract_id])
    : null;
  return slip;
}
