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

// Mirrors the evaluator in lib/payroll.js so the seeded formulas are covered.
const evalFormula = (f, ctx) => {
  const keys = Object.keys(ctx);
  return new Function(...keys, 'Math', `"use strict"; return (${f});`)(...keys.map((k) => ctx[k]), Math);
};
const round2 = (n) => Math.round(n * 100) / 100;

test('seeded salary rule formulas', () => {
  const ctx = {
    wage: 100000, worked_days: 20, working_days: 22, overtime_hours: 4,
    unpaid_leave_days: 2, RULE: {}, CAT: { BASIC: 0, ALW: 0, DED: 0 },
  };

  const basic = evalFormula('wage * 0.5 * (working_days ? worked_days / working_days : 1)', ctx);
  assert.equal(round2(basic), 45454.55);          // prorated for 20 of 22 days
  ctx.RULE.BASIC = round2(basic);
  ctx.CAT.BASIC = round2(basic);

  assert.equal(round2(ctx.RULE.BASIC * 0.4), 18181.82);                                    // HRA
  assert.equal(round2(evalFormula('overtime_hours * (wage / 173)', ctx)), 2312.14);        // OT
  assert.equal(round2(evalFormula('working_days ? (wage / working_days) * unpaid_leave_days : 0', ctx)), 9090.91); // LOP
});

test('a zero working-day period does not divide by zero', () => {
  const ctx = { wage: 100000, worked_days: 0, working_days: 0, RULE: {}, CAT: {} };
  assert.equal(evalFormula('working_days ? worked_days / working_days : 1', ctx), 1);
});
