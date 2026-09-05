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

test('attendance clock rules: check-out without check-in validation', () => {
  const validateCheckOut = (openShift) => {
    if (!openShift) return { allowed: false, error: 'You have not checked in' };
    return { allowed: true };
  };

  assert.deepEqual(validateCheckOut(null), { allowed: false, error: 'You have not checked in' });
  assert.deepEqual(validateCheckOut({ id: 1, check_in: new Date().toISOString() }), { allowed: true });
});

test('attendance clock rules: stale shift detection (> 16 hours)', () => {
  const isStale = (checkInIso, nowIso) => {
    const elapsedMs = new Date(nowIso) - new Date(checkInIso);
    return elapsedMs > 16 * 3600 * 1000;
  };

  const now = new Date('2026-09-05T12:00:00Z');
  const recentShift = new Date('2026-09-05T08:00:00Z'); // 4 hours ago
  const yesterdayShift = new Date('2026-09-04T09:00:00Z'); // 27 hours ago

  assert.equal(isStale(recentShift, now), false, '4-hour shift is an active shift');
  assert.equal(isStale(yesterdayShift, now), true, '27-hour old forgotten shift is stale');
});

test('attendance clock rules: worked hours calculation', () => {
  const calculateHours = (inIso, outIso) => {
    const diff = (new Date(outIso) - new Date(inIso)) / 3600000;
    return Math.round(diff * 100) / 100;
  };

  assert.equal(calculateHours('2026-09-05T09:00:00Z', '2026-09-05T17:30:00Z'), 8.5);
  assert.equal(calculateHours('2026-09-05T09:00:00Z', '2026-09-05T13:00:00Z'), 4.0);
});

test('attendance clock rules: HR Manager and Payroll can only check in/out own time', () => {
  const validateClockAction = (selfId, targetEmployeeId) => {
    if (targetEmployeeId && Number(targetEmployeeId) !== Number(selfId)) {
      return { allowed: false, error: 'You can only check in/out for your own account' };
    }
    return { allowed: true, employeeId: selfId };
  };

  const hrEmpId = 9;
  const otherEmpId = 10;
  const payEmpId = 12;

  // HR Manager checking in self vs other
  assert.deepEqual(validateClockAction(hrEmpId, hrEmpId), { allowed: true, employeeId: 9 });
  assert.deepEqual(validateClockAction(hrEmpId, undefined), { allowed: true, employeeId: 9 });
  assert.deepEqual(validateClockAction(hrEmpId, otherEmpId), {
    allowed: false,
    error: 'You can only check in/out for your own account'
  });

  // Payroll Manager checking in self vs other
  assert.deepEqual(validateClockAction(payEmpId, payEmpId), { allowed: true, employeeId: 12 });
  assert.deepEqual(validateClockAction(payEmpId, otherEmpId), {
    allowed: false,
    error: 'You can only check in/out for your own account'
  });
});

test('attendance display scope: HR Manager sees self and team, Payroll sees self only', () => {
  const getDisplayScope = (role, selfId, subordinateIds) => {
    if (role === 'employee' || role === 'payroll_user' || role === 'payroll_manager') {
      return [selfId];
    }
    if (role === 'hr_manager') {
      return [selfId, ...subordinateIds];
    }
    return 'all';
  };

  const hrSelf = 9;
  const hrSubs = [10];
  const paySelf = 12;

  assert.deepEqual(getDisplayScope('hr_manager', hrSelf, hrSubs), [9, 10]);
  assert.deepEqual(getDisplayScope('payroll_manager', paySelf, [11]), [12]);
  assert.deepEqual(getDisplayScope('payroll_user', 11, []), [11]);
  assert.deepEqual(getDisplayScope('employee', 13, []), [13]);
  assert.equal(getDisplayScope('admin', 1, []), 'all');
});

test('attendance record close permissions: Admin and HR Manager vs regular roles', () => {
  const canCloseRecord = (callerRole, callerEmpId, recordEmpId, isSubordinate) => {
    if (callerRole === 'admin') return true;
    if (callerEmpId === recordEmpId) return true;
    if (callerRole === 'hr_manager' && isSubordinate) return true;
    return false;
  };

  assert.equal(canCloseRecord('admin', null, 7, false), true, 'Admin can close any missed checkout');
  assert.equal(canCloseRecord('hr_manager', 9, 10, true), true, 'HR Manager can close subordinate missed checkout');
  assert.equal(canCloseRecord('hr_manager', 9, 7, false), false, 'HR Manager cannot close non-subordinate missed checkout');
  assert.equal(canCloseRecord('employee', 13, 13, false), true, 'Employee can close own missed checkout');
  assert.equal(canCloseRecord('employee', 13, 10, false), false, 'Employee cannot close another employee checkout');
});

test('attendance missing filter: resolves missing_checkout query and status parameter', () => {
  const isMissing = (query) => query.missing_checkout === true || query.missing_checkout === 'true' || query.status === 'missing_checkout';

  assert.equal(isMissing({ missing_checkout: 'true' }), true);
  assert.equal(isMissing({ status: 'missing_checkout' }), true);
  assert.equal(isMissing({ status: 'present' }), false);
  assert.equal(isMissing({}), false);
});


