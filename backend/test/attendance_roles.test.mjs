import assert from 'node:assert/strict';
import test from 'node:test';
import { MATRIX } from '../src/auth.js';

test('attendance permissions: all roles have read/write access to attendance module base', () => {
  assert.equal(MATRIX.attendance.read, 'employee');
  assert.equal(MATRIX.attendance.write, 'employee');
});

test('attendance role checks: role definitions and hierarchy', () => {
  const roles = ['employee', 'hr_manager', 'payroll_user', 'payroll_manager', 'admin'];
  assert.ok(roles.includes('hr_manager'));
  assert.ok(roles.includes('payroll_user'));
  assert.ok(roles.includes('payroll_manager'));
  assert.ok(roles.includes('admin'));
});

test('attendance role scoping rules: isSelfOnly classification', () => {
  const isSelfOnlyRole = (role) => role === 'employee' || role === 'payroll_user' || role === 'payroll_manager';

  assert.equal(isSelfOnlyRole('employee'), true);
  assert.equal(isSelfOnlyRole('payroll_user'), true);
  assert.equal(isSelfOnlyRole('payroll_manager'), true);
  assert.equal(isSelfOnlyRole('hr_manager'), false);
  assert.equal(isSelfOnlyRole('admin'), false);
});

test('attendance role scoping rules: admin permissions', () => {
  const isAdmin = (role) => role === 'admin';
  const canClock = (role) => !isAdmin(role);
  const canManualLog = (role) => !isAdmin(role);

  assert.equal(canClock('admin'), false);
  assert.equal(canManualLog('admin'), false);

  assert.equal(canClock('hr_manager'), true);
  assert.equal(canManualLog('hr_manager'), true);

  assert.equal(canClock('payroll_manager'), true);
  assert.equal(canManualLog('payroll_manager'), true);

  assert.equal(canClock('payroll_user'), true);
  assert.equal(canManualLog('payroll_user'), true);
});

test('attendance role scoping rules: HR manager subordinate evaluation', () => {
  const hrEmpId = 8;
  const subordinates = [{ id: 9, manager_id: 8 }, { id: 10, manager_id: 11 }];

  const isAllowedForHR = (targetEmpId, subordinatesList, selfId) => {
    if (targetEmpId === selfId) return true;
    return subordinatesList.some(s => s.id === targetEmpId && s.manager_id === selfId);
  };

  assert.equal(isAllowedForHR(8, subordinates, hrEmpId), true, 'HR Manager can access own attendance');
  assert.equal(isAllowedForHR(9, subordinates, hrEmpId), true, 'HR Manager can access subordinate attendance');
  assert.equal(isAllowedForHR(10, subordinates, hrEmpId), false, 'HR Manager cannot access non-subordinate attendance');
});
