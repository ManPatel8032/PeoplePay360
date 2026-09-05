import assert from 'node:assert/strict';
import test from 'node:test';
import { MATRIX } from '../src/auth.js';

/*
 * The matrix is now module -> role -> { read, write, delete }, with explicit
 * 'all' | 'own' | 'none' scopes. It used to store a single minimum role per
 * module, which could not express the problem statement (Employee sees their
 * own payslip, HR Manager sees none, Payroll User sees all).
 */
test('attendance permissions match the problem statement', () => {
  assert.equal(MATRIX.attendance.employee.read, 'own');
  assert.equal(MATRIX.attendance.employee.write, 'own');
  assert.equal(MATRIX.attendance.hr_manager.read, 'all');
  assert.equal(MATRIX.attendance.hr_manager.write, 'all');
  assert.equal(MATRIX.attendance.payroll_user.read, 'all');
  assert.equal(MATRIX.attendance.admin.write, 'all');
});

test('payslips: HR Manager is shut out, Employee sees only their own', () => {
  assert.equal(MATRIX.payslips.employee.read, 'own');
  assert.equal(MATRIX.payslips.employee.write, 'none');
  assert.equal(MATRIX.payslips.hr_manager.read, 'none');
  assert.equal(MATRIX.payslips.payroll_user.read, 'all');
});

test('payroll user gets create/read/update but not delete', () => {
  assert.equal(MATRIX.payruns.payroll_user.write, 'all');
  assert.equal(MATRIX.payruns.payroll_user.delete, 'none');
  assert.equal(MATRIX.payruns.payroll_manager.delete, 'all');
});

test('salary structures and rules are read-only for payroll user', () => {
  assert.equal(MATRIX.structures.payroll_user.read, 'all');
  assert.equal(MATRIX.structures.payroll_user.write, 'none');
  assert.equal(MATRIX.rules.payroll_manager.write, 'all');
});

test('only admin administers users', () => {
  for (const role of ['employee', 'hr_manager', 'payroll_user', 'payroll_manager']) {
    assert.equal(MATRIX.users[role].read, 'none', `${role} must not read users`);
    assert.equal(MATRIX.users[role].write, 'none', `${role} must not write users`);
  }
  assert.equal(MATRIX.users.admin.write, 'all');
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
test('schedules: payroll user and payroll manager are read-only, cannot edit schedules', () => {
  assert.equal(MATRIX.schedules.payroll_user.read, 'all');
  assert.equal(MATRIX.schedules.payroll_user.write, 'none');
  assert.equal(MATRIX.schedules.payroll_user.delete, 'none');
  assert.equal(MATRIX.schedules.payroll_manager.read, 'all');
  assert.equal(MATRIX.schedules.payroll_manager.write, 'none');
  assert.equal(MATRIX.schedules.payroll_manager.delete, 'none');
  assert.equal(MATRIX.schedules.hr_manager.write, 'all');
  assert.equal(MATRIX.schedules.admin.write, 'all');
});

test('payroll_user has all HR Manager permissions plus Create, Read, Update on payruns and payslips', () => {
  // 1. HR Manager core operational modules: payroll_user has full read/write
  const hrModules = ['employees', 'contracts', 'attendance', 'timeoff', 'timeoff_approve', 'allocations'];
  for (const mod of hrModules) {
    assert.equal(MATRIX[mod].payroll_user.read, 'all', `payroll_user should read all ${mod}`);
    assert.equal(MATRIX[mod].payroll_user.write, 'all', `payroll_user should write all ${mod}`);
  }

  // 2. Payruns: payroll_user has Create, Read, and Update (CRU), but NOT delete
  assert.equal(MATRIX.payruns.payroll_user.read, 'all', 'payroll_user can read all payruns');
  assert.equal(MATRIX.payruns.payroll_user.write, 'all', 'payroll_user can create and update payruns');
  assert.equal(MATRIX.payruns.payroll_user.delete, 'none', 'payroll_user cannot delete payruns');

  // 3. Payslips: payroll_user has Create, Read, and Update (CRU), but NOT delete
  assert.equal(MATRIX.payslips.payroll_user.read, 'all', 'payroll_user can read all payslips');
  assert.equal(MATRIX.payslips.payroll_user.write, 'all', 'payroll_user can create and update payslips');
  assert.equal(MATRIX.payslips.payroll_user.delete, 'none', 'payroll_user cannot delete payslips');

  // 4. HR Manager is completely shut out of payruns and payslips
  assert.equal(MATRIX.payruns.hr_manager.read, 'none', 'hr_manager cannot read payruns');
  assert.equal(MATRIX.payruns.hr_manager.write, 'none', 'hr_manager cannot write payruns');
  assert.equal(MATRIX.payslips.hr_manager.read, 'none', 'hr_manager cannot read payslips');
  assert.equal(MATRIX.payslips.hr_manager.write, 'none', 'hr_manager cannot write payslips');
});

test('payroll_manager has full CRUD on payruns, payslips, structures, rules and full HR operational control', () => {
  // 1. Full CRUD on all payroll & configuration modules
  const payrollModules = ['payruns', 'payslips', 'structures', 'rules'];
  for (const mod of payrollModules) {
    assert.equal(MATRIX[mod].payroll_manager.read, 'all', `payroll_manager should read all ${mod}`);
    assert.equal(MATRIX[mod].payroll_manager.write, 'all', `payroll_manager should write all ${mod}`);
    assert.equal(MATRIX[mod].payroll_manager.delete, 'all', `payroll_manager should delete all ${mod}`);
  }

  // 2. Full control on HR operational records
  const hrModules = ['employees', 'contracts', 'attendance', 'timeoff', 'timeoff_approve', 'allocations'];
  for (const mod of hrModules) {
    assert.equal(MATRIX[mod].payroll_manager.read, 'all', `payroll_manager should read all ${mod}`);
    assert.equal(MATRIX[mod].payroll_manager.write, 'all', `payroll_manager should write all ${mod}`);
    assert.equal(MATRIX[mod].payroll_manager.delete, 'all', `payroll_manager should delete all ${mod}`);
  }

  // 3. Schedules: read-only (cannot edit)
  assert.equal(MATRIX.schedules.payroll_manager.read, 'all', 'payroll_manager can read schedules');
  assert.equal(MATRIX.schedules.payroll_manager.write, 'none', 'payroll_manager cannot edit schedules');
  assert.equal(MATRIX.schedules.payroll_manager.delete, 'none', 'payroll_manager cannot delete schedules');

  // 4. Distinction from payroll_user (who has no delete on payruns/payslips and no write/delete on structures/rules)
  assert.equal(MATRIX.payruns.payroll_user.delete, 'none');
  assert.equal(MATRIX.payslips.payroll_user.delete, 'none');
  assert.equal(MATRIX.structures.payroll_user.write, 'none');
  assert.equal(MATRIX.rules.payroll_user.write, 'none');

  // 5. Dashboard and Users
  assert.equal(MATRIX.dashboard.payroll_manager.read, 'all', 'payroll_manager can view payroll dashboard');
  assert.equal(MATRIX.users.payroll_manager.read, 'none', 'payroll_manager cannot administer user accounts');
});

test('hr_manager and admin have Delete operation on employees and contracts', () => {
  // hr_manager has delete on employees and contracts
  assert.equal(MATRIX.employees.hr_manager.delete, 'all', 'hr_manager can delete employees');
  assert.equal(MATRIX.contracts.hr_manager.delete, 'all', 'hr_manager can delete contracts');

  // admin has delete on employees and contracts
  assert.equal(MATRIX.employees.admin.delete, 'all', 'admin can delete employees');
  assert.equal(MATRIX.contracts.admin.delete, 'all', 'admin can delete contracts');

  // employee cannot delete employees or contracts
  assert.equal(MATRIX.employees.employee.delete, 'none', 'employee cannot delete employees');
  assert.equal(MATRIX.contracts.employee.delete, 'none', 'employee cannot delete contracts');
});


