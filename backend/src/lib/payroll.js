/**
 * Payroll engine.
 *
 * The two rules the problem statement cares most about:
 *  1. A payslip uses the ONE contract whose date range covers the payroll period.
 *  2. Salary rules run in `sequence` order; each rule can reference the result of
 *     any rule that already ran, by code (RULE.BASIC) or by category total (CAT.ALW).
 */
import { query, one, tx } from '../db.js';
import {
  scheduledDays, hoursBetween, daysBetween, monthBounds, monthFraction,
  eachDay, hoursByDayOfWeek, weeklyHours,
} from './dates.js';
import { evaluateFormula } from './formula.js';

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Hours in a working day when no schedule says otherwise. */
const DEFAULT_FULL_DAY = 8;
/** Grace before extra time counts as overtime — matches the attendance status rule. */
const OVERTIME_GRACE_HOURS = 1;
/** Working hours in a month when no schedule is on file (a 40-hour week). */
const DEFAULT_MONTHLY_HOURS = 173;

const today = () => new Date().toISOString().slice(0, 10);

/**
 * The part of a payroll period the contract actually runs for.
 *
 * A contract that starts or ends inside the period only earns for the days it
 * covers — being on the payroll for five days of March is not a March salary.
 * Returns null when the contract does not reach into the period at all.
 */
export function contractWindow(contract, periodStart, periodEnd) {
  const start = contract?.start_date && contract.start_date > periodStart ? contract.start_date : periodStart;
  const end = contract?.end_date && contract.end_date < periodEnd ? contract.end_date : periodEnd;
  return start > end ? null : { start, end };
}

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

const EMPTY_STATS = {
  workingDays: 0, workedDays: 0, attendedDays: 0, attendanceHours: 0, overtimeHours: 0,
  missingCheckouts: 0, lateDays: 0, manualEdits: 0, paidLeaveDays: 0, unpaidLeaveDays: 0,
  leaveDays: 0, absentDays: 0, scheduledHoursPerWeek: 0,
};

/** Attendance + time off aggregated for the period the contract covers. */
export async function periodStats(employee, contract, periodStart, periodEnd) {
  const scheduleId = contract?.schedule_id || employee.schedule_id;
  const lines = scheduleId
    ? await query('SELECT * FROM schedule_lines WHERE schedule_id = $1', [scheduleId])
    : [];

  // Everything below is measured over the contract's own window, not the whole
  // payroll period, so a contract starting or ending mid-period is not paid,
  // marked absent or credited leave for days it does not cover.
  const win = contractWindow(contract, periodStart, periodEnd);
  if (!win) return { ...EMPTY_STATS };
  const { start, end } = win;

  const hasSchedule = lines.length > 0;
  const hoursPerDow = hoursByDayOfWeek(lines);
  const dowOf = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
  const fullDayOn = (d) => hoursPerDow.get(dowOf(d)) || DEFAULT_FULL_DAY;

  const scheduledDates = hasSchedule
    ? eachDay(start, end).filter((d) => hoursPerDow.has(dowOf(d)))
    : eachDay(start, end);
  const workingDays = scheduledDates.length;

  const att = await query(
    `SELECT * FROM attendance
      WHERE employee_id = $1 AND check_in::date BETWEEN $2 AND $3`,
    [employee.id, start, end]
  );

  const attendedDates = new Set(att.map((a) => a.check_in.slice(0, 10)));
  const attendedDays = attendedDates.size;
  const attendanceHours = att.reduce((s, a) => s + hoursBetween(a.check_in, a.check_out), 0);
  const missingCheckouts = att.filter((a) => !a.check_out).length;
  const lateDays = att.filter((a) => a.status === 'late').length;
  const manualEdits = att.filter((a) => a.manual_edit).length;

  // Overtime is decided by the clock against the employee's own scheduled day.
  // Reading it off the `status` column meant anyone who could edit an attendance
  // record could mint overtime pay by relabelling it, and the old hard-coded
  // 8-hour day under-paid everyone on a longer roster and over-paid part-timers.
  const overtimeHours = att.reduce((s, a) => {
    if (!a.check_out) return s;
    const fullDay = fullDayOn(a.check_in.slice(0, 10));
    const worked = hoursBetween(a.check_in, a.check_out);
    return worked > fullDay + OVERTIME_GRACE_HOURS ? s + (worked - fullDay) : s;
  }, 0);

  // approved leave overlapping the period, split paid vs unpaid (unpaid => LOP)
  const leaves = await query(
    `SELECT r.*, t.is_paid, t.name AS type_name
       FROM time_off_requests r JOIN time_off_types t ON t.id = r.type_id
      WHERE r.employee_id = $1 AND r.state = 'approved'
        AND r.date_from <= $2 AND r.date_to >= $3`,
    [employee.id, end, start]
  );

  // A request already records what it costs — half days included — so the
  // period must charge that declared duration, not a fresh count of calendar
  // days. Leave straddling the period boundary is split by working days.
  const countDays = (a, b) => (hasSchedule ? scheduledDays(lines, a, b) : daysBetween(a, b));

  const leaveDates = new Set();
  let paidLeaveDays = 0;
  let unpaidLeaveDays = 0;
  for (const l of leaves) {
    const from = l.date_from > start ? l.date_from : start;
    const to = l.date_to < end ? l.date_to : end;
    if (from > to) continue;
    for (const d of eachDay(from, to)) leaveDates.add(d);

    const wholeDays = countDays(l.date_from, l.date_to);
    const inPeriod = countDays(from, to);
    const declared = Number(l.duration) || wholeDays;
    const d = wholeDays > 0 ? round2(declared * (inPeriod / wholeDays)) : declared;

    if (l.is_paid) paidLeaveDays += d;
    else unpaidLeaveDays += d;
  }
  paidLeaveDays = round2(paidLeaveDays);
  unpaidLeaveDays = round2(unpaidLeaveDays);

  // A scheduled day with neither attendance nor approved leave is an unexplained
  // absence, and pay must reflect it — otherwise never turning up costs nothing.
  // Days that have not happened yet are not absences, so an open period (this
  // month's draft run) is not charged for the days still to come.
  const now = today();
  const absentDays = scheduledDates.filter(
    (d) => d < now && !attendedDates.has(d) && !leaveDates.has(d)
  ).length;

  const workedDays = round2(Math.max(0, workingDays - unpaidLeaveDays - absentDays));

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
    absentDays,
    leaveDays: round2(paidLeaveDays + unpaidLeaveDays),
    scheduledHoursPerWeek: round2(weeklyHours(lines)),
    coverageStart: start,
    coverageEnd: end,
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
  const ran = { GROSS: false, NET: false };            // did an explicit rule produce it?
  const lines = [];
  const periodRatio = ctx.period_ratio ?? 1;

  for (const rule of rules) {
    let amount = 0;
    try {
      if (rule.compute_type === 'fixed') {
        amount = (Number(rule.amount) || 0) * periodRatio;
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
    if (rule.category in ran) ran[rule.category] = true;
    lines.push({
      rule_id: rule.id, code: rule.code, name: rule.name,
      category: rule.category, sequence: rule.sequence, amount,
    });
  }

  // GROSS / NET are normally explicit rules; fall back to derived totals only when
  // no such rule ran. Testing the amount instead treated a legitimate zero — the
  // net of a month lost entirely to unpaid absence — as "no rule", and the
  // fallback then reported a negative salary the payslip never actually showed.
  const gross = ran.GROSS ? cat.GROSS : round2(cat.BASIC + cat.ALW);
  const net = ran.NET ? cat.NET : round2(gross - Math.abs(cat.DED));
  return { lines, gross, net, categories: cat };
}

/** Evaluate a rule formula against the payroll context. See lib/formula.js. */
const evalFormula = evaluateFormula;

/** Pre-flight checks surfaced before validation (technical guideline 4). */
export async function collectWarnings({
  employee, contract, stats, payrunId, payrunStructureId, periodStart, periodEnd,
}) {
  const w = [];
  if (!contract) {
    w.push({ level: 'error', message: 'No contract covers this payroll period' });
  } else {
    if (!contract.structure_id) w.push({ level: 'warning', message: 'Contract has no salary structure assigned' });
    if (contract.structure_id && payrunStructureId && contract.structure_id !== payrunStructureId) {
      const names = await one(
        `SELECT (SELECT name FROM salary_structures WHERE id = $1) AS contract_structure,
                (SELECT name FROM salary_structures WHERE id = $2) AS payrun_structure`,
        [contract.structure_id, payrunStructureId]
      );
      w.push({
        level: 'warning',
        message: `Paid on the contract's structure "${names.contract_structure}", not the payrun's `
          + `"${names.payrun_structure}" — the contract decides which rules apply.`,
      });
    }
    if (!Number(contract.wage)) w.push({ level: 'error', message: 'Contract wage is zero' });
    if (contract.end_date && contract.end_date <= periodEnd)
      w.push({ level: 'info', message: `Contract expires ${contract.end_date} — renewal needed` });

    const win = contractWindow(contract, periodStart, periodEnd);
    if (!win) {
      w.push({ level: 'error', message: 'Contract does not run during any part of this period' });
    } else if (win.start !== periodStart || win.end !== periodEnd) {
      w.push({
        level: 'info',
        message: `Contract runs ${win.start} → ${win.end} of this period `
          + `(${daysBetween(win.start, win.end)} of ${daysBetween(periodStart, periodEnd)} days) — pay prorated`,
      });
    }
    const overlaps = await overlappingContracts(employee.id, periodStart, periodEnd);
    if (overlaps.length > 1)
      w.push({ level: 'error', message: `${overlaps.length} concurrent running contracts cover this period` });
  }
  if (!employee.bank_account) w.push({ level: 'error', message: 'Missing bank account details' });
  if (!employee.work_email) w.push({ level: 'warning', message: 'No work email — payslip cannot be emailed' });
  if (stats.missingCheckouts) w.push({ level: 'warning', message: `${stats.missingCheckouts} attendance record(s) missing check-out` });
  if (stats.unpaidLeaveDays) w.push({ level: 'info', message: `${stats.unpaidLeaveDays} unpaid leave day(s) deducted` });
  if (stats.absentDays) {
    w.push({
      level: 'warning',
      message: `${stats.absentDays} scheduled day(s) with neither attendance nor approved leave — treated as unpaid`,
    });
  }
  if (stats.attendedDays === 0) w.push({ level: 'warning', message: 'No attendance recorded in this period' });

  // Nobody may be paid twice for the same day, so the check is an overlap, not an
  // exact period match: being paid for 1-31 Aug also rules out 15-31 Aug.
  const overlaps = await query(
    `SELECT ps.period_start, ps.period_end, ps.state, r.name AS payrun_name
       FROM payslips ps JOIN payruns r ON r.id = ps.payrun_id
      WHERE ps.employee_id = $1 AND ps.state <> 'cancelled' AND ps.payrun_id <> $4
        AND ps.period_start <= $3 AND ps.period_end >= $2
      ORDER BY ps.period_start LIMIT 5`,
    [employee.id, periodStart, periodEnd, payrunId || 0]
  );
  if (overlaps.length) {
    const list = overlaps
      .map((o) => `${o.period_start} → ${o.period_end} (${o.payrun_name}, ${o.state})`)
      .join('; ');
    w.push({
      level: 'error',
      message: `Already payrolled for an overlapping period: ${list}`,
    });
  }

  return w;
}

/**
 * Build evaluation context for payroll rules.
 * Automatically prorates monthly contract wage and fixed allowances if the payrun
 * covers a custom period (e.g., 10 days instead of a full month).
 */
export function buildPayrollContext(contract, stats, periodStart, periodEnd) {
  const baseWage = Number(contract?.wage) || 0;
  const periodDays = daysBetween(periodStart, periodEnd);
  const d = new Date(periodStart + 'T00:00:00Z');
  const { start: mStart, end: mEnd } = monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
  const monthDays = daysBetween(mStart, mEnd);

  // Pay covers the days the contract actually runs, measured against each
  // month's own length: a span crossing a month boundary cannot be divided by
  // the first month's length, and a contract ending mid-period cannot be paid
  // for the days after it ends.
  const win = contractWindow(contract, periodStart, periodEnd);
  const contractDays = win ? daysBetween(win.start, win.end) : 0;
  const isFullMonth = !!win && win.start === mStart && win.end === mEnd;
  const periodRatio = !win ? 0 : (isFullMonth ? 1 : monthFraction(win.start, win.end));
  const wage = round2(baseWage * periodRatio);

  // An hour is worth the same whatever the period, so the hourly rate comes from
  // the monthly wage and the employee's own roster — not a fixed 173-hour month.
  const weekly = Number(stats.scheduledHoursPerWeek) || 0;
  const monthlyHours = weekly ? round2((weekly * 52) / 12) : DEFAULT_MONTHLY_HOURS;
  const hourlyRate = monthlyHours ? round2(baseWage / monthlyHours) : 0;

  return {
    wage,
    monthly_wage: baseWage,
    period_ratio: periodRatio,
    period_days: periodDays,
    contract_days: contractDays,
    month_days: monthDays,
    hourly_rate: hourlyRate,
    monthly_hours: monthlyHours,
    absent_days: stats.absentDays || 0,
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

  // An employee is paid on the structure their own contract names; the payrun's
  // structure is only the batch default, used when the contract names none.
  // The other way round, a contractor swept into a regular run was paid on
  // regular-employee rules — HRA, conveyance, PF, professional tax — none of
  // which are part of a contractor agreement.
  const structureId = contract?.structure_id || payrun.structure_id;

  const ctx = buildPayrollContext(contract, stats, slip.period_start, slip.period_end);

  const { lines, gross, net } = structureId
    ? await computeRules(structureId, ctx)
    : { lines: [], gross: 0, net: 0 };

  const warnings = await collectWarnings({
    employee, contract, stats,
    payrunId: slip.payrun_id, payrunStructureId: payrun.structure_id,
    periodStart: slip.period_start, periodEnd: slip.period_end,
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
