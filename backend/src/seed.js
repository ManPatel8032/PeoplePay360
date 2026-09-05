/**
 * Seeds a demo-ready database: 6 months of contracts, attendance, leave and
 * payroll history so the dashboard has real trends on first load.
 *
 *   npm run seed           add seed data (drops nothing)
 *   npm run reset          drop everything, recreate, reseed
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query, one, tx, migrate, waitForDb } from './db.js';
import { computePayslip } from './lib/payroll.js';
import { monthBounds } from './lib/dates.js';

const RESET = process.argv.includes('--reset');

const pick = (arr, i) => arr[i % arr.length];
const rnd = (a, b) => a + Math.random() * (b - a);
const rndInt = (a, b) => Math.floor(rnd(a, b + 1));

async function main() {
  await waitForDb();

  if (RESET) {
    console.log('dropping schema...');
    await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  }
  await migrate();

  const existing = await one('SELECT COUNT(*)::int n FROM employees');
  if (existing.n > 0 && !RESET) {
    console.log(`Database already has ${existing.n} employees. Use "npm run reset" to start clean.`);
    await pool.end();
    return;
  }

  console.log('seeding...');

  // ---------- departments & positions ----------
  const deptNames = ['Executive', 'Engineering', 'Sales', 'Human Resources', 'Finance', 'Operations'];
  const depts = {};
  for (const n of deptNames) depts[n] = (await one('INSERT INTO departments (name) VALUES ($1) RETURNING id', [n])).id;

  const posDefs = [
    ['Managing Director', 'Executive'],
    ['Senior Engineer', 'Engineering'], ['Engineer', 'Engineering'], ['QA Engineer', 'Engineering'],
    ['Account Executive', 'Sales'], ['Sales Manager', 'Sales'],
    ['HR Business Partner', 'Human Resources'], ['Recruiter', 'Human Resources'],
    ['Financial Analyst', 'Finance'], ['Payroll Officer', 'Finance'],
    ['Operations Associate', 'Operations'],
  ];
  const pos = {};
  for (const [n, d] of posDefs)
    pos[n] = (await one('INSERT INTO job_positions (name, department_id) VALUES ($1,$2) RETURNING id', [n, depts[d]])).id;

  // ---------- working schedules (A3) ----------
  const std = (await one("INSERT INTO working_schedules (name,type) VALUES ('Standard 40 Hours/Week','full_time') RETURNING id")).id;
  const part = (await one("INSERT INTO working_schedules (name,type) VALUES ('Part Time 20 Hours/Week','part_time') RETURNING id")).id;
  const flex = (await one("INSERT INTO working_schedules (name,type) VALUES ('Flexible 4-Day Week','flexible') RETURNING id")).id;

  for (const d of [1, 2, 3, 4, 5])
    await query('INSERT INTO schedule_lines (schedule_id,day_of_week,start_time,end_time,break_minutes) VALUES ($1,$2,$3,$4,$5)',
      [std, d, '09:00', '18:00', 60]);
  for (const d of [1, 2, 3, 4, 5])
    await query('INSERT INTO schedule_lines (schedule_id,day_of_week,start_time,end_time,break_minutes) VALUES ($1,$2,$3,$4,$5)',
      [part, d, '09:00', '13:00', 0]);
  for (const d of [1, 2, 3, 4])
    await query('INSERT INTO schedule_lines (schedule_id,day_of_week,start_time,end_time,break_minutes) VALUES ($1,$2,$3,$4,$5)',
      [flex, d, '09:00', '19:00', 60]);

  // ---------- salary structures & rules (A5, A6) ----------
  const regular = (await one("INSERT INTO salary_structures (name,code) VALUES ('Regular Salary','REG') RETURNING id")).id;
  const contractStruct = (await one("INSERT INTO salary_structures (name,code) VALUES ('Contractor Salary','CON') RETURNING id")).id;

  const ruleRows = [
    // structure, name, code, category, seq, type, amount, percent_base, formula
    [regular, 'Basic Salary',            'BASIC', 'BASIC', 10,  'formula', 0,  null,    'wage * 0.5 * (working_days ? worked_days / working_days : 1)'],
    [regular, 'House Rent Allowance',    'HRA',   'ALW',   20,  'percent', 40, 'BASIC', null],
    [regular, 'Conveyance Allowance',    'CONV',  'ALW',   30,  'fixed',   1600, null,  null],
    [regular, 'Medical Allowance',       'MED',   'ALW',   40,  'fixed',   1250, null,  null],
    [regular, 'Special Allowance',       'SPEC',  'ALW',   50,  'formula', 0,  null,    'Math.max(0, wage * (working_days ? worked_days / working_days : 1) - RULE.BASIC - RULE.HRA - RULE.CONV - RULE.MED)'],
    [regular, 'Overtime Pay',            'OT',    'ALW',   60,  'formula', 0,  null,    'overtime_hours * (wage / 173)'],
    [regular, 'Gross Salary',            'GROSS', 'GROSS', 100, 'formula', 0,  null,    'CAT.BASIC + CAT.ALW'],
    [regular, 'Provident Fund (12%)',    'PF',    'DED',   110, 'percent', 12, 'BASIC', null],
    [regular, 'Professional Tax',        'PT',    'DED',   120, 'fixed',   200, null,   null],
    [regular, 'Income Tax (TDS)',        'TDS',   'DED',   130, 'formula', 0,  null,    'RULE.GROSS > 50000 ? RULE.GROSS * 0.1 : RULE.GROSS * 0.05'],
    [regular, 'Loss of Pay',             'LOP',   'DED',   140, 'formula', 0,  null,    'working_days ? (wage / working_days) * unpaid_leave_days : 0'],
    [regular, 'Net Salary',              'NET',   'NET',   200, 'formula', 0,  null,    'RULE.GROSS - CAT.DED'],

    [contractStruct, 'Contract Fee',     'BASIC', 'BASIC', 10,  'formula', 0,  null,    'wage * (working_days ? worked_days / working_days : 1)'],
    [contractStruct, 'Gross',            'GROSS', 'GROSS', 100, 'formula', 0,  null,    'CAT.BASIC'],
    [contractStruct, 'TDS (10%)',        'TDS',   'DED',   110, 'percent', 10, 'GROSS', null],
    [contractStruct, 'Net Payable',      'NET',   'NET',   200, 'formula', 0,  null,    'RULE.GROSS - CAT.DED'],
  ];
  for (const r of ruleRows)
    await query(
      `INSERT INTO salary_rules (structure_id,name,code,category,sequence,compute_type,amount,percent_base,formula)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, r
    );

  // ---------- time off types (A4) ----------
  const typeDefs = [
    ['Paid Time Off', 'PTO', 'day', true, true, true, '#4f46e5'],
    ['Sick Leave', 'SICK', 'day', true, true, true, '#0ea5e9'],
    ['Unpaid Leave', 'UNPAID', 'day', false, true, false, '#dc2626'],
    ['Compensatory Off', 'COMP', 'day', true, true, true, '#059669'],
  ];
  const types = {};
  for (const t of typeDefs)
    types[t[1]] = (await one(
      `INSERT INTO time_off_types (name,code,unit,requires_allocation,requires_approval,is_paid,color)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, t
    )).id;

  // ---------- employees ----------
  // Index 0 is the Managing Director: the single root of the org chart and the
  // only employee without a manager. Everybody else — department heads
  // included — reports to somebody.
  const people = [
    ['Rohini Deshpande','Executive',        'Managing Director',   'full_time', 260000, std,  'HDFC0001-1000001'],
    ['Aarav Sharma',    'Engineering',      'Senior Engineer',     'full_time', 145000, std,  'HDFC0001-8827341'],
    ['Priya Nair',      'Engineering',      'Engineer',            'full_time', 95000,  std,  'ICIC0002-3391822'],
    ['Rohan Mehta',     'Engineering',      'Engineer',            'full_time', 88000,  std,  'SBIN0003-7712094'],
    ['Sneha Kulkarni',  'Engineering',      'QA Engineer',         'full_time', 72000,  std,  null],
    ['Vikram Rao',      'Sales',            'Sales Manager',       'full_time', 120000, std,  'AXIS0004-2214877'],
    ['Ananya Iyer',     'Sales',            'Account Executive',   'full_time', 78000,  std,  'HDFC0001-5566120'],
    ['Kabir Singh',     'Sales',            'Account Executive',   'contract',  60000,  flex, 'KOTK0005-9911233'],
    ['Meera Joshi',     'Human Resources',  'HR Business Partner', 'full_time', 98000,  std,  'ICIC0002-4478210'],
    ['Devansh Gupta',   'Human Resources',  'Recruiter',           'part_time', 45000,  part, 'SBIN0003-1188447'],
    ['Ishita Banerjee', 'Finance',          'Financial Analyst',   'full_time', 105000, std,  'AXIS0004-6633901'],
    ['Arjun Patel',     'Finance',          'Payroll Officer',     'full_time', 92000,  std,  'HDFC0001-7799002'],
    ['Nisha Verma',     'Operations',       'Operations Associate','full_time', 65000,  std,  'KOTK0005-3322118'],
    ['Farhan Qureshi',  'Operations',       'Operations Associate','intern',    25000,  part, null],
    ['Tara Menon',      'Engineering',      'Engineer',            'full_time', 91000,  std,  'ICIC0002-8845112'],
  ];

  const today = new Date();
  const joinBase = new Date(Date.UTC(today.getUTCFullYear() - 2, 0, 1));
  const empIds = [];

  for (let i = 0; i < people.length; i++) {
    const [name, dept, position, etype, , sched, bank] = people[i];
    const email = name.toLowerCase().replace(/[^a-z]+/g, '.') + '@peoplepay360.com';
    const join = new Date(joinBase.getTime() + i * 37 * 86400000).toISOString().slice(0, 10);
    const row = await one(
      `INSERT INTO employees (name, work_email, phone, department_id, job_position_id, schedule_id,
                              employee_type, status, bank_account, join_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [name, email, `+91 9${rndInt(100000000, 999999999)}`, depts[dept], pos[position], sched,
       etype, name === 'Devansh Gupta' ? 'on_leave' : 'active', bank, join]
    );
    empIds.push(row.id);
  }

  /* Name -> id, so the reporting lines below don't silently break the next time
     somebody inserts a row into `people`. */
  const byName = Object.fromEntries(people.map((p, i) => [p[0], empIds[i]]));

  /*
   * Reporting lines. Every employee gets a manager; the Managing Director is
   * the single root (manager_id stays NULL). Department heads report to the MD,
   * so managers have managers too.
   */
  const MD = byName['Rohini Deshpande'];
  const DEPARTMENT_HEADS = {
    Engineering:       byName['Aarav Sharma'],
    Sales:             byName['Vikram Rao'],
    'Human Resources': byName['Meera Joshi'],
    // Arjun (payroll_manager) heads Finance so the reporting line runs the same
    // way as the permission hierarchy — Ishita is payroll_user and reports up.
    Finance:           byName['Arjun Patel'],
    Operations:        byName['Nisha Verma'],
  };

  for (const [deptName, headId] of Object.entries(DEPARTMENT_HEADS)) {
    // the head reports to the MD ...
    await query('UPDATE employees SET manager_id = $1 WHERE id = $2', [MD, headId]);
    // ... and everyone else in that department reports to the head
    await query(
      'UPDATE employees SET manager_id = $1 WHERE department_id = $2 AND id <> $1',
      [headId, depts[deptName]]
    );
  }

  const orphans = await query(
    'SELECT name FROM employees WHERE manager_id IS NULL AND id <> $1', [MD]
  );
  if (orphans.length) {
    throw new Error(`Seed produced employees with no manager: ${orphans.map((o) => o.name).join(', ')}`);
  }

  // ---------- users / roles ----------
  const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
  const passwordHash = bcrypt.hashSync(SEED_PASSWORD, 10);

  /*
   * Logins are deliberately NOT one-per-employee.
   *
   *  - Ops Admin has no employee record at all (an IT account: no contract,
   *    no payslip) — proof the two tables are not interchangeable.
   *  - Everyone the access rules actually concern gets a login: the MD and
   *    every department head, so "a manager's attendance is Admin-only" and
   *    the org chart can both be demonstrated from the accounts they affect.
   *  - The rank-and-file are left without logins on purpose, because plenty of
   *    real employees are paid without ever signing in.
   *
   * Note Aarav and Vikram manage teams but hold the plain `employee` role:
   * being a manager is a position in the org chart, not a permission level.
   */
  const userDefs = [
    ['Ops Admin',        'admin@peoplepay360.com',     'admin',           null],
    ['Rohini Deshpande', 'rohini.md@peoplepay360.com', 'admin',           byName['Rohini Deshpande']],
    ['Meera Joshi',      'meera.hr@peoplepay360.com',  'hr_manager',      byName['Meera Joshi']],
    ['Arjun Patel',      'arjun.pay@peoplepay360.com', 'payroll_manager', byName['Arjun Patel']],
    ['Ishita Banerjee',  'ishita.pay@peoplepay360.com','payroll_user',    byName['Ishita Banerjee']],
    ['Aarav Sharma',     'aarav.emp@peoplepay360.com', 'employee',        byName['Aarav Sharma']],
    ['Vikram Rao',       'vikram.emp@peoplepay360.com','employee',        byName['Vikram Rao']],
    ['Nisha Verma',      'nisha.emp@peoplepay360.com', 'employee',        byName['Nisha Verma']],
    ['Priya Nair',       'priya.emp@peoplepay360.com', 'employee',        byName['Priya Nair']],
  ];
  for (const [name, email, role, empId] of userDefs) {
    await query(
      `INSERT INTO users (name, email, password_hash, role, employee_id, is_active, must_change_password)
       VALUES ($1, $2, $3, $4, $5, TRUE, TRUE)`,
      [name, email, passwordHash, role, empId]
    );
  }

  // ---------- contracts (A2) — history + a renewal so period selection matters ----------
  const twoYearsAgo = new Date(Date.UTC(today.getUTCFullYear() - 1, today.getUTCMonth() - 11, 1)).toISOString().slice(0, 10);
  const renewalDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 3, 1)).toISOString().slice(0, 10);
  const dayBefore = new Date(new Date(renewalDate + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);

  for (let i = 0; i < empIds.length; i++) {
    const [name, dept, position, etype, wage, sched] = people[i];
    const structure = etype === 'contract' ? contractStruct : regular;

    if (i % 3 === 0) {
      // expired original + running renewal at a higher wage: payroll must pick by period
      await query(
        `INSERT INTO contracts (employee_id,name,start_date,end_date,department_id,job_position_id,
                                schedule_id,wage,structure_id,state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'expired')`,
        [empIds[i], `${name} — Initial Contract`, twoYearsAgo, dayBefore, depts[dept], pos[position], sched, Math.round(wage * 0.85), structure]
      );
      await query(
        `INSERT INTO contracts (employee_id,name,start_date,end_date,department_id,job_position_id,
                                schedule_id,wage,structure_id,state)
         VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,'running')`,
        [empIds[i], `${name} — Renewal`, renewalDate, depts[dept], pos[position], sched, wage, structure]
      );
    } else {
      const endDate = etype === 'contract'
        ? new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0)).toISOString().slice(0, 10)
        : null;
      await query(
        `INSERT INTO contracts (employee_id,name,start_date,end_date,department_id,job_position_id,
                                schedule_id,wage,structure_id,state)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'running')`,
        [empIds[i], `${name} — Employment Contract`, twoYearsAgo, endDate, depts[dept], pos[position], sched, wage, structure]
      );
    }
  }

  // ---------- allocations (A4) ----------
  const yearStart = `${today.getUTCFullYear()}-01-01`;
  const yearEnd = `${today.getUTCFullYear()}-12-31`;
  for (const id of empIds) {
    await query(
      `INSERT INTO allocations (employee_id,type_id,amount,state,valid_from,valid_to,note)
       VALUES ($1,$2,$3,'approved',$4,$5,'Annual PTO grant')`, [id, types.PTO, 18, yearStart, yearEnd]
    );
    await query(
      `INSERT INTO allocations (employee_id,type_id,amount,state,valid_from,valid_to,note)
       VALUES ($1,$2,$3,'approved',$4,$5,'Annual sick leave grant')`, [id, types.SICK, 10, yearStart, yearEnd]
    );
  }
  // one pending allocation so the approval flow has something to demo
  await query(
    `INSERT INTO allocations (employee_id,type_id,amount,state,valid_from,valid_to,note)
     VALUES ($1,$2,5,'draft',$3,$4,'Comp-off for release weekend')`,
    [byName['Aarav Sharma'], types.COMP, yearStart, yearEnd]
  );

  // ---------- attendance: last 6 months of working days ----------
  console.log('seeding attendance...');
  const attRows = [];
  for (let m = 5; m >= 0; m--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
    const { start, end } = monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
    const cur = new Date(start + 'T00:00:00Z');
    const last = new Date(end + 'T00:00:00Z');
    while (cur <= last) {
      const dow = cur.getUTCDay();
      if (dow !== 0 && dow !== 6 && cur <= today) {
        const day = cur.toISOString().slice(0, 10);
        for (let i = 0; i < empIds.length; i++) {
          if (Math.random() < 0.06) continue;                    // absent / on leave
          const inH = pick([9, 9, 9, 9, 10], rndInt(0, 4));
          const inM = rndInt(0, 55);
          const late = inH >= 10 || inM > 30;
          const overtime = Math.random() < 0.12;
          const dur = overtime ? rnd(9.5, 11) : rnd(7.5, 9);
          const checkIn = `${day}T${String(inH).padStart(2, '0')}:${String(inM).padStart(2, '0')}:00Z`;
          const noCheckout = Math.random() < 0.03;
          const checkOut = noCheckout ? null : new Date(new Date(checkIn).getTime() + dur * 3600000).toISOString();
          attRows.push([empIds[i], checkIn, checkOut,
            noCheckout ? 'present' : overtime ? 'overtime' : late ? 'late' : 'present',
            Math.random() < 0.05]);
        }
      }
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
  }
  await tx(async (c) => {
    for (const r of attRows)
      await c.query('INSERT INTO attendance (employee_id,check_in,check_out,status,manual_edit) VALUES ($1,$2,$3,$4,$5)', r);
  });
  console.log(`  ${attRows.length} attendance records`);

  // ---------- time off requests ----------
  const leaveRows = [];
  for (let m = 5; m >= 0; m--) {
    const base = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, rndInt(5, 20)));
    for (let k = 0; k < 3; k++) {
      const emp = pick(empIds, rndInt(0, empIds.length - 1));
      const from = new Date(base.getTime() + k * 3 * 86400000);
      const len = rndInt(1, 3);
      const to = new Date(from.getTime() + (len - 1) * 86400000);
      const typeCode = pick(['PTO', 'PTO', 'SICK', 'UNPAID'], rndInt(0, 3));
      leaveRows.push([emp, types[typeCode], from.toISOString().slice(0, 10), to.toISOString().slice(0, 10),
        len, m === 0 ? 'to_approve' : 'approved', `${typeCode} request`]);
    }
  }
  for (const r of leaveRows)
    await query(
      `INSERT INTO time_off_requests (employee_id,type_id,date_from,date_to,duration,state,reason)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`, r
    );
  console.log(`  ${leaveRows.length} time off requests`);

  // ---------- payroll history: 5 closed months + 1 open draft ----------
  console.log('seeding payroll history...');
  for (let m = 5; m >= 1; m--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - m, 1));
    const { start, end } = monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
    const label = d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

    const run = await one(
      `INSERT INTO payruns (name,structure_id,period_start,period_end,state)
       VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
      [`Monthly Payroll — ${label}`, regular, start, end]
    );
    for (const id of empIds) {
      // contractors are paid on their own structure, so keep them out of the regular run
      const isContractor = people[empIds.indexOf(id)][3] === 'contract';
      if (isContractor) continue;
      await query(
        `INSERT INTO payslips (payrun_id,employee_id,period_start,period_end,structure_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [run.id, id, start, end, regular]
      );
    }
    const slips = await query('SELECT id FROM payslips WHERE payrun_id = $1', [run.id]);
    for (const s of slips) await computePayslip(s.id);
    await query("UPDATE payslips SET state='paid' WHERE payrun_id=$1", [run.id]);
    await query("UPDATE payruns SET state='paid' WHERE id=$1", [run.id]);
    console.log(`  ${label}: ${slips.length} payslips`);
  }

  // current month left as a draft payrun so the demo has something to Compute live
  const cur = monthBounds(today.getUTCFullYear(), today.getUTCMonth() + 1);
  const curLabel = today.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const draftRun = await one(
    `INSERT INTO payruns (name,structure_id,period_start,period_end,state)
     VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
    [`Monthly Payroll — ${curLabel}`, regular, cur.start, cur.end]
  );
  for (const id of empIds.slice(0, 6))
    await query(
      `INSERT INTO payslips (payrun_id,employee_id,period_start,period_end,structure_id)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`, [draftRun.id, id, cur.start, cur.end, regular]
    );

  const counts = await one(`
    SELECT (SELECT COUNT(*)::int FROM employees)  AS employees,
           (SELECT COUNT(*)::int FROM contracts)  AS contracts,
           (SELECT COUNT(*)::int FROM attendance) AS attendance,
           (SELECT COUNT(*)::int FROM time_off_requests) AS requests,
           (SELECT COUNT(*)::int FROM payruns)    AS payruns,
           (SELECT COUNT(*)::int FROM payslips)   AS payslips`);
  console.log('\nSeed complete:', counts);
  console.log(`Draft payrun ready to demo: "${curLabel}" (id ${draftRun.id})`);
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
