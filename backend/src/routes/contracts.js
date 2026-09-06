/** Contracts (A2). Owner: Track A / Section 2. */
import { Router } from 'express';
import { query, one } from '../db.js';
import { can } from '../auth.js';
import { ah } from '../lib/crud.js';
import { blockPayrollStaffPay, rejected, employeeScopeFilter, canSeeEmployee } from '../lib/guards.js';

export const contracts = Router();

const CONTRACT_SQL = `
  SELECT c.*, e.name AS employee_name, e.employee_number, d.name AS department_name,
         j.name AS job_position_name, s.name AS structure_name, w.name AS schedule_name
    FROM contracts c
    JOIN employees e ON e.id = c.employee_id
    LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN job_positions j ON j.id = c.job_position_id
    LEFT JOIN salary_structures s ON s.id = c.structure_id
    LEFT JOIN working_schedules w ON w.id = c.schedule_id`;

/** Find any overlapping running contract for this employee */
async function findOverlappingContracts(employeeId, startDate, endDate, excludeId = null) {
  let sql = `
    SELECT * FROM contracts
     WHERE employee_id = $1 AND state = 'running'
       AND start_date <= COALESCE($2::date, DATE '9999-12-31')
       AND (end_date IS NULL OR end_date >= $3::date)`;
  const params = [employeeId, endDate || null, startDate];
  if (excludeId) {
    params.push(excludeId);
    sql += ` AND id <> $${params.length}`;
  }
  return query(sql, params);
}

// List contracts
contracts.get('/', can('contracts', 'read'), ah(async (req, res) => {
  const state = req.query.state;
  const structureId = req.query.structure_id;
  const search = req.query.search;

  const where = [];
  const params = [];

  // Visibility based on contracts role scope
  const scopeSql = employeeScopeFilter(req, 'c.employee_id', params, 'contracts');
  if (scopeSql) where.push(scopeSql);

  const employeeId = req.query.employee_id;
  if (employeeId) {
    params.push(employeeId);
    where.push(`c.employee_id = $${params.length}`);
  }
  if (state) {
    params.push(state);
    where.push(`c.state = $${params.length}`);
  }
  if (structureId) {
    params.push(structureId);
    where.push(`c.structure_id = $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    where.push(`(c.name ILIKE $${params.length} OR e.name ILIKE $${params.length} OR e.employee_number ILIKE $${params.length})`);
  }

  const sql = `${CONTRACT_SQL}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY c.start_date DESC`;
  const rows = await query(sql, params);
  res.json({ data: rows, meta: { total: rows.length } });
}));

// Salary structures lookup for contracts
contracts.get('/structures', can('contracts', 'read'), ah(async (_req, res) => {
  const rows = await query('SELECT id, name, code FROM salary_structures WHERE active = TRUE ORDER BY name');
  res.json({ data: rows });
}));

// Pre-save overlap check endpoint (works for both new and existing contracts)
contracts.post('/check-overlap', can('contracts', 'read'), ah(async (req, res) => {
  const { employee_id, start_date, end_date, exclude_id } = req.body;
  if (!employee_id || !start_date) {
    return res.status(400).json({ error: 'employee_id and start_date are required' });
  }
  const overlapping = await findOverlappingContracts(employee_id, start_date, end_date, exclude_id);
  res.json({ data: { overlapping } });
}));

// Get contract by ID
contracts.get('/:id', can('contracts', 'read'), ah(async (req, res) => {
  const row = await one(`${CONTRACT_SQL} WHERE c.id = $1`, [req.params.id]);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (!canSeeEmployee(req, row.employee_id, 'contracts')) {
    return res.status(403).json({ error: 'This contract is outside your team' });
  }
  res.json({ data: row });
}));

// Create contract
contracts.post('/', can('contracts', 'write'), ah(async (req, res) => {
  const {
    employee_id, name, start_date, end_date,
    department_id, job_position_id, schedule_id,
    wage, structure_id, state = 'draft'
  } = req.body;

  if (!employee_id) return res.status(400).json({ error: 'Employee is required' });

  if (!canSeeEmployee(req, employee_id, 'contracts', 'write')) {
    return res.status(403).json({ error: 'Cannot create contract for an employee outside your team' });
  }

  // Only an Admin may set the pay terms of payroll staff.
  if (rejected(res, await blockPayrollStaffPay(req, employee_id))) return;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Contract name is required' });
  if (!start_date) return res.status(400).json({ error: 'Start date is required' });

  const numWage = Number(wage);
  if (isNaN(numWage) || numWage <= 0) {
    return res.status(400).json({ error: 'Wage must be greater than 0' });
  }

  if (end_date && end_date < start_date) {
    return res.status(400).json({ error: 'End date must be on or after start date' });
  }

  if (state === 'running' && !structure_id) {
    return res.status(400).json({ error: 'Salary structure is required for running contracts' });
  }

  // Concurrent-contract guard
  if (state === 'running') {
    const overlapping = await findOverlappingContracts(employee_id, start_date, end_date);
    if (overlapping.length > 0) {
      const conflict = overlapping[0];
      const conflictSpan = `${conflict.start_date} to ${conflict.end_date || 'indefinite'}`;
      return res.status(400).json({
        error: `Cannot have overlapping running contracts. Conflicts with "${conflict.name}" (${conflictSpan})`,
        conflict,
      });
    }
  }

  const inserted = await one(
    `INSERT INTO contracts (
       employee_id, name, start_date, end_date,
       department_id, job_position_id, schedule_id,
       wage, structure_id, state
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [
      employee_id, name.trim(), start_date, end_date || null,
      department_id || null, job_position_id || null, schedule_id || null,
      numWage, structure_id || null, state
    ]
  );

  const full = await one(`${CONTRACT_SQL} WHERE c.id = $1`, [inserted.id]);
  res.status(201).json({ data: full });
}));

// Update contract
contracts.patch('/:id', can('contracts', 'write'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM contracts WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  if (!canSeeEmployee(req, existing.employee_id, 'contracts', 'write')) {
    return res.status(403).json({ error: 'This contract is outside your team' });
  }

  // Only an Admin may change the pay terms of payroll staff. Non-pay edits
  // (dates, department, schedule) stay open to HR.
  if (rejected(res, await blockPayrollStaffPay(req, existing.employee_id, req.body))) return;
  if (req.body.employee_id !== undefined && req.body.employee_id !== existing.employee_id) {
    if (!canSeeEmployee(req, req.body.employee_id, 'contracts', 'write')) {
      return res.status(403).json({ error: 'Cannot reassign contract to employee outside your team' });
    }
    if (rejected(res, await blockPayrollStaffPay(req, req.body.employee_id, req.body))) return;
  }

  const employee_id = req.body.employee_id !== undefined ? req.body.employee_id : existing.employee_id;
  const name = req.body.name !== undefined ? req.body.name : existing.name;
  const start_date = req.body.start_date !== undefined ? req.body.start_date : existing.start_date;
  const end_date = req.body.end_date !== undefined ? (req.body.end_date || null) : existing.end_date;
  const department_id = req.body.department_id !== undefined ? (req.body.department_id || null) : existing.department_id;
  const job_position_id = req.body.job_position_id !== undefined ? (req.body.job_position_id || null) : existing.job_position_id;
  const schedule_id = req.body.schedule_id !== undefined ? (req.body.schedule_id || null) : existing.schedule_id;
  const wage = req.body.wage !== undefined ? Number(req.body.wage) : Number(existing.wage);
  const structure_id = req.body.structure_id !== undefined ? (req.body.structure_id || null) : existing.structure_id;
  const state = req.body.state !== undefined ? req.body.state : existing.state;

  if (req.body.name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ error: 'Contract name is required' });
  }
  if (isNaN(wage) || wage <= 0) return res.status(400).json({ error: 'Wage must be greater than 0' });
  if (end_date && end_date < start_date) {
    return res.status(400).json({ error: 'End date must be on or after start date' });
  }
  if (state === 'running' && !structure_id) {
    return res.status(400).json({ error: 'Salary structure is required for running contracts' });
  }

  // Concurrent-contract guard on update
  if (state === 'running') {
    const overlapping = await findOverlappingContracts(employee_id, start_date, end_date, existing.id);
    if (overlapping.length > 0) {
      const conflict = overlapping[0];
      const conflictSpan = `${conflict.start_date} to ${conflict.end_date || 'indefinite'}`;
      return res.status(400).json({
        error: `Cannot have overlapping running contracts. Conflicts with "${conflict.name}" (${conflictSpan})`,
        conflict,
      });
    }
  }

  await one(
    `UPDATE contracts SET
       employee_id = $1, name = $2, start_date = $3, end_date = $4,
       department_id = $5, job_position_id = $6, schedule_id = $7,
       wage = $8, structure_id = $9, state = $10
     WHERE id = $11 RETURNING id`,
    [
      employee_id, typeof name === 'string' ? name.trim() : name, start_date, end_date,
      department_id, job_position_id, schedule_id,
      wage, structure_id, state, req.params.id
    ]
  );

  const full = await one(`${CONTRACT_SQL} WHERE c.id = $1`, [req.params.id]);
  res.json({ data: full });
}));

// Delete contract
contracts.delete('/:id', can('contracts', 'delete'), ah(async (req, res) => {
  const contract = await one('SELECT id, name, employee_id FROM contracts WHERE id = $1', [req.params.id]);
  if (!contract) return res.status(404).json({ error: 'Contract not found' });

  if (!canSeeEmployee(req, contract.employee_id, 'contracts')) {
    return res.status(403).json({ error: 'This contract is outside your team' });
  }
  if (rejected(res, await blockPayrollStaffPay(req, contract.employee_id))) return;

  // Clear contract_id on any payslips referencing this contract
  await query('UPDATE payslips SET contract_id = NULL WHERE contract_id = $1', [req.params.id]);

  await query('DELETE FROM contracts WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

// Check overlap for existing contract
contracts.post('/:id/check-overlap', can('contracts', 'read'), ah(async (req, res) => {
  const c = await one('SELECT * FROM contracts WHERE id = $1', [req.params.id]);
  if (!c) return res.status(404).json({ error: 'Not found' });
  const overlapping = await findOverlappingContracts(c.employee_id, c.start_date, c.end_date, c.id);
  res.json({ data: { overlapping } });
}));
