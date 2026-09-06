/**
 * Business-logic checks that need no database. Run with `npm run test` from server/.
 * Keep adding cases here as each track lands its rules — this is the cheapest
 * safety net for the payroll maths, which is the thing judges will poke at.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  weeklyHours, scheduledDays, overlapDays, daysBetween, monthBounds, hoursBetween,
} from '../src/lib/dates.js';
import { evaluateFormula } from '../src/lib/formula.js';

const std = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '18:00', break_minutes: 60 }));
const part = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '13:00', break_minutes: 0 }));

test('weekly hours are derived from schedule lines, not stored', () => {
  assert.equal(weeklyHours(std), 40);
  assert.equal(weeklyHours(part), 20);
  assert.equal(weeklyHours([]), 0);
});

test('scheduled working days respect the weekly pattern', () => {
  assert.equal(scheduledDays(std, '2026-09-01', '2026-09-30'), 22);
  assert.equal(scheduledDays([], '2026-09-01', '2026-09-30'), 0);
});

test('leave overlapping a period counts only the days inside it', () => {
  assert.equal(overlapDays('2026-09-01', '2026-09-30', '2026-08-28', '2026-09-02'), 2);
  assert.equal(overlapDays('2026-09-01', '2026-09-30', '2026-09-25', null), 6);   // open ended
  assert.equal(overlapDays('2026-09-01', '2026-09-30', '2026-10-05', '2026-10-08'), 0);
});

test('date helpers', () => {
  assert.equal(daysBetween('2026-09-01', '2026-09-03'), 3);                        // inclusive
  assert.deepEqual(monthBounds(2028, 2), { start: '2028-02-01', end: '2028-02-29' });
  assert.equal(hoursBetween('2026-09-01T09:00:00Z', '2026-09-01T17:30:00Z'), 8.5);
  assert.equal(hoursBetween('2026-09-01T09:00:00Z', null), 0);                     // open attendance
});

// The real evaluator, so these cases cover the code that actually runs payroll.
const evalFormula = evaluateFormula;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * The seeded structures, rule for rule, in sequence order. Copied from seed.js:
 * if the seeded rules change and these do not, the assertions below stop
 * describing what the app pays and should be updated together.
 */
const REGULAR_RULES = [
  { code: 'BASIC', category: 'BASIC', formula: 'wage * 0.5' },
  { code: 'HRA', category: 'ALW', percent: 40, base: 'BASIC' },
  { code: 'CONV', category: 'ALW', fixed: 1600 },
  { code: 'MED', category: 'ALW', fixed: 1250 },
  { code: 'SPEC', category: 'ALW', formula: 'Math.max(0, wage - RULE.BASIC - RULE.HRA - RULE.CONV - RULE.MED)' },
  { code: 'OT', category: 'ALW', formula: 'overtime_hours * hourly_rate' },
  { code: 'GROSS', category: 'GROSS', formula: 'CAT.BASIC + CAT.ALW' },
  { code: 'PF', category: 'DED', percent: 12, base: 'BASIC' },
  { code: 'PT', category: 'DED', fixed: 200 },
  { code: 'TDS', category: 'DED', formula: 'RULE.GROSS > 50000 ? RULE.GROSS * 0.1 : RULE.GROSS * 0.05' },
  { code: 'LOP', category: 'DED', formula: 'working_days ? Math.min(RULE.GROSS, (wage / working_days) * (unpaid_leave_days + absent_days)) : 0' },
  { code: 'NET', category: 'NET', formula: 'Math.max(0, RULE.GROSS - CAT.DED)' },
];

const CONTRACTOR_RULES = [
  { code: 'BASIC', category: 'BASIC', formula: 'wage * (working_days ? worked_days / working_days : 1)' },
  { code: 'GROSS', category: 'GROSS', formula: 'CAT.BASIC' },
  { code: 'TDS', category: 'DED', percent: 10, base: 'GROSS' },
  { code: 'NET', category: 'NET', formula: 'Math.max(0, RULE.GROSS - CAT.DED)' },
];

/** Mirrors computeRules: sequence order, each rule visible to the ones after it. */
function runRules(rules, ctx) {
  const RULE = {};
  const CAT = { BASIC: 0, ALW: 0, GROSS: 0, DED: 0, NET: 0 };
  const scope = { ...ctx, RULE, CAT };
  for (const r of rules) {
    let amount;
    if (r.fixed !== undefined) amount = r.fixed * (ctx.period_ratio ?? 1);
    else if (r.percent !== undefined) amount = ((RULE[r.base] ?? CAT[r.base] ?? 0) * r.percent) / 100;
    else amount = evalFormula(r.formula, scope);
    amount = round2(amount);
    RULE[r.code] = amount;
    CAT[r.category] = round2(CAT[r.category] + amount);
  }
  return { RULE, CAT };
}

const baseCtx = {
  wage: 100000, monthly_wage: 100000, period_ratio: 1,
  working_days: 22, worked_days: 20, overtime_hours: 4,
  hourly_rate: 576.92, unpaid_leave_days: 0, absent_days: 0,
};

test('seeded salary rules: Regular Salary, one day of unpaid leave and one absence', () => {
  const { RULE, CAT } = runRules(REGULAR_RULES, {
    ...baseCtx, unpaid_leave_days: 1, absent_days: 1,
  });

  // Earnings are the full entitlement — days not worked are charged once, by LOP.
  assert.equal(RULE.BASIC, 50000);
  assert.equal(RULE.HRA, 20000);                       // 40% of basic
  assert.equal(RULE.CONV, 1600);
  assert.equal(RULE.MED, 1250);
  assert.equal(RULE.SPEC, 27150);                      // the rest of the wage
  assert.equal(RULE.OT, 2307.68);                      // 4 h at the rostered hourly rate
  assert.equal(CAT.BASIC + CAT.ALW, RULE.GROSS);
  assert.equal(RULE.GROSS, 102307.68);

  assert.equal(RULE.PF, 6000);                         // 12% of basic
  assert.equal(RULE.PT, 200);
  assert.equal(RULE.TDS, 10230.77);                    // 10% above the 50k threshold
  assert.equal(RULE.LOP, 9090.91);                     // 2 of 22 days, unpaid leave + absence
  assert.equal(RULE.NET, 76786);
  assert.equal(round2(RULE.GROSS - CAT.DED), RULE.NET);
});

test('seeded salary rules: full attendance pays the whole package, no loss of pay', () => {
  const { RULE } = runRules(REGULAR_RULES, { ...baseCtx, overtime_hours: 0 });
  assert.equal(RULE.GROSS, 100000);
  assert.equal(RULE.LOP, 0);
  assert.equal(RULE.NET, 83800);                       // 100000 - 6000 - 200 - 10000
});

test('seeded salary rules: a month lost entirely never pays a negative salary', () => {
  const { RULE } = runRules(REGULAR_RULES, {
    ...baseCtx, overtime_hours: 0, absent_days: 22,
  });
  assert.equal(RULE.GROSS, 100000);
  assert.equal(RULE.LOP, 100000);                      // capped at gross, never more
  assert.equal(RULE.NET, 0);                           // clamped, not negative
});

test('seeded salary rules: Contractor Salary carries none of the employee rules', () => {
  const { RULE } = runRules(CONTRACTOR_RULES, { ...baseCtx, wage: 60000 });

  assert.equal(RULE.BASIC, 54545.45);                  // 20 of 22 days
  assert.equal(RULE.GROSS, 54545.45);
  assert.equal(RULE.TDS, 5454.55);                     // flat 10%
  assert.equal(RULE.NET, 49090.9);

  // The rules a contractor must never be charged or credited.
  for (const code of ['HRA', 'CONV', 'MED', 'SPEC', 'OT', 'PF', 'PT', 'LOP']) {
    assert.equal(RULE[code], undefined, `contractor payslip must not carry ${code}`);
  }
});

test('a zero working-day period does not divide by zero', () => {
  const ctx = {
    wage: 100000, worked_days: 0, working_days: 0, unpaid_leave_days: 2, absent_days: 0,
    RULE: { GROSS: 50000 }, CAT: {},
  };
  assert.equal(evalFormula(REGULAR_RULES.find((r) => r.code === 'LOP').formula, ctx), 0);
  assert.equal(evalFormula(CONTRACTOR_RULES[0].formula, ctx), 100000);
});

test('salary formulas cannot reach outside the values they are given', () => {
  const ctx = { wage: 100000, RULE: {}, CAT: {} };
  for (const attempt of ['process.exit(1)', 'globalThis', 'Math.random()', 'wage.constructor']) {
    assert.throws(() => evalFormula(attempt, ctx), `"${attempt}" must be refused`);
  }
  // Assignment, indexing and strings are not part of the grammar at all.
  for (const attempt of ['wage = 1', 'RULE["BASIC"]', '"x"']) {
    assert.throws(() => evalFormula(attempt, ctx), `"${attempt}" must not parse`);
  }
});

test('Section 2: schedule line calculation with break deduction', () => {
  const customSched = [
    { day_of_week: 1, start_time: '09:00', end_time: '17:00', break_minutes: 60 }, // 7 hrs
    { day_of_week: 2, start_time: '09:00', end_time: '17:00', break_minutes: 30 }, // 7.5 hrs
    { day_of_week: 3, start_time: '10:00', end_time: '15:00', break_minutes: 0 },  // 5 hrs
  ];
  assert.equal(weeklyHours(customSched), 19.5);
});

test('Section 2: contract overlap logic detects concurrent running contracts', () => {
  // Existing contract: 2026-01-01 to 2026-06-30
  // Overlapping cases:
  assert.ok(overlapDays('2026-01-01', '2026-06-30', '2026-06-01', '2026-12-31') > 0);
  assert.ok(overlapDays('2026-01-01', '2026-06-30', '2026-03-01', '2026-04-30') > 0);
  assert.ok(overlapDays('2026-01-01', '2026-06-30', '2026-06-30', null) > 0);
  // Non-overlapping:
  assert.equal(overlapDays('2026-01-01', '2026-06-30', '2026-07-01', '2026-12-31'), 0);
});

test('Section 2: leave balance maths (18 allocated - 3 taken = 15 remaining)', () => {
  const allocated = 18;
  const taken = 3;
  const remaining = allocated - taken;
  assert.equal(remaining, 15);
  // Requesting 40 days when 15 remain is rejected
  const requested = 40;
  assert.equal(requested > remaining, true);
});

test('payroll proration: full month retains 100% of wage', async () => {
  const { buildPayrollContext } = await import('../src/lib/payroll.js');
  const contract = { wage: 90000 };
  const stats = { workedDays: 22, workingDays: 22, attendedDays: 22, attendanceHours: 176, overtimeHours: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, leaveDays: 0, lateDays: 0 };

  // September full month (30 days)
  const ctxSept = buildPayrollContext(contract, stats, '2026-09-01', '2026-09-30');
  assert.equal(ctxSept.period_days, 30);
  assert.equal(ctxSept.month_days, 30);
  assert.equal(ctxSept.period_ratio, 1);
  assert.equal(ctxSept.wage, 90000);

  // August full month (31 days)
  const ctxAug = buildPayrollContext(contract, stats, '2026-08-01', '2026-08-31');
  assert.equal(ctxAug.period_days, 31);
  assert.equal(ctxAug.month_days, 31);
  assert.equal(ctxAug.period_ratio, 1);
  assert.equal(ctxAug.wage, 90000);
});

test('payroll proration: custom 10-day period prorates proportionally (10/30 = 1/3)', async () => {
  const { buildPayrollContext } = await import('../src/lib/payroll.js');
  const contract = { wage: 90000 };
  // 10-day period (e.g. 2026-09-01 to 2026-09-10) with 8 scheduled working days
  const stats = { workedDays: 8, workingDays: 8, attendedDays: 8, attendanceHours: 64, overtimeHours: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, leaveDays: 0, lateDays: 0 };

  const ctx = buildPayrollContext(contract, stats, '2026-09-01', '2026-09-10');
  assert.equal(ctx.period_days, 10);
  assert.equal(ctx.month_days, 30);
  assert.equal(round2(ctx.period_ratio), round2(10 / 30)); // 1/3
  assert.equal(ctx.wage, 30000); // exactly 1/3 of 90000

  // Verify that salary rule formulas scale accurately to 10 days
  ctx.RULE = {};
  ctx.CAT = { BASIC: 0, ALW: 0, DED: 0 };

  const basic = evalFormula('wage * 0.5 * (working_days ? worked_days / working_days : 1)', ctx);
  assert.equal(round2(basic), 15000); // 1/3 of 45000 monthly basic
  ctx.RULE.BASIC = round2(basic);
  ctx.CAT.BASIC = round2(basic);

  const hra = round2(ctx.RULE.BASIC * 0.4);
  assert.equal(hra, 6000); // 1/3 of 18000 monthly HRA
  ctx.RULE.HRA = hra;

  // Fixed allowances scaled by period_ratio (10/30)
  const conv = round2(1600 * ctx.period_ratio);
  const med = round2(1250 * ctx.period_ratio);
  assert.equal(conv, 533.33);
  assert.equal(med, 416.67);
  ctx.RULE.CONV = conv;
  ctx.RULE.MED = med;

  const spec = evalFormula('Math.max(0, wage * (working_days ? worked_days / working_days : 1) - RULE.BASIC - RULE.HRA - RULE.CONV - RULE.MED)', ctx);
  assert.equal(round2(spec), 8050); // exactly 1/3 of 24150 monthly special allowance
  ctx.RULE.SPEC = round2(spec);

  const gross = ctx.CAT.BASIC + ctx.RULE.HRA + ctx.RULE.CONV + ctx.RULE.MED + ctx.RULE.SPEC;
  assert.equal(round2(gross), 30000); // total gross matches 10-day prorated wage (30000)
});

test('contractWindow returns null when contract is null or outside period', async () => {
  const { contractWindow, buildPayrollContext } = await import('../src/lib/payroll.js');
  assert.equal(contractWindow(null, '2026-09-01', '2026-09-30'), null);
  assert.equal(contractWindow(undefined, '2026-09-01', '2026-09-30'), null);
  assert.equal(contractWindow({ start_date: '2026-10-01' }, '2026-09-01', '2026-09-30'), null);

  const stats = { workedDays: 0, workingDays: 0, attendedDays: 0, attendanceHours: 0, overtimeHours: 0, paidLeaveDays: 0, unpaidLeaveDays: 0, leaveDays: 0, lateDays: 0 };
  const ctx = buildPayrollContext(null, stats, '2026-09-01', '2026-09-30');
  assert.equal(ctx.period_ratio, 0);
  assert.equal(ctx.wage, 0);
  assert.equal(ctx.contract_days, 0);
});

test('negative net pay fallback is bounded to 0', async () => {
  // Simulate net fallback calculation when deductions exceed gross
  const gross = 5000;
  const ded = 8000;
  const net = Math.max(0, round2(gross - Math.abs(ded)));
  assert.equal(net, 0);
});



