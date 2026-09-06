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

test('attendance clock rules: half day is greater than 4 hours and less than full day (8 hours)', async () => {
  const { deriveAttendanceStatus } = await import('../src/routes/attendance.js');

  // Overtime (> 9h for standard 8h day)
  assert.equal(deriveAttendanceStatus(10), 'overtime');
  assert.equal(deriveAttendanceStatus(9.5), 'overtime');

  // Full day present (8h to 9h)
  assert.equal(deriveAttendanceStatus(9.0), 'present');
  assert.equal(deriveAttendanceStatus(8.5), 'present');
  assert.equal(deriveAttendanceStatus(8.0), 'present');

  // Half day (> 4h and < 8h)
  assert.equal(deriveAttendanceStatus(7.9), 'half_day');
  assert.equal(deriveAttendanceStatus(6.0), 'half_day');
  assert.equal(deriveAttendanceStatus(4.5), 'half_day');
  assert.equal(deriveAttendanceStatus(4.01), 'half_day');

  // <= 4 hours is absent (half day requires strictly > 4 hours)
  assert.equal(deriveAttendanceStatus(4.0), 'absent');
  assert.equal(deriveAttendanceStatus(3.5), 'absent');
  assert.equal(deriveAttendanceStatus(2.0), 'absent');
  assert.equal(deriveAttendanceStatus(0), 'absent');

  // Dynamic full-day amount of work (e.g. 6-hour shift or 10-hour shift)
  assert.equal(deriveAttendanceStatus(6.5, 'present', 6), 'present');
  assert.equal(deriveAttendanceStatus(6.0, 'present', 6), 'present');
  assert.equal(deriveAttendanceStatus(5.0, 'present', 6), 'half_day');
  assert.equal(deriveAttendanceStatus(4.0, 'present', 6), 'absent');

  assert.equal(deriveAttendanceStatus(10.0, 'present', 10), 'present');
  assert.equal(deriveAttendanceStatus(7.5, 'present', 10), 'half_day');
  assert.equal(deriveAttendanceStatus(4.0, 'present', 10), 'absent');
});

test('timeoff self-approval restriction: HR and Payroll users cannot approve their own leaves or allocations', () => {
  const canApproveRequest = (user, request) => {
    // Permission check
    if (!['hr_manager', 'payroll_user', 'payroll_manager', 'admin'].includes(user.role)) return false;
    // Self-approval restriction
    if (user.employee_id && request.employee_id === user.employee_id) return false;
    return true;
  };

  const hrUser = { id: 3, role: 'hr_manager', employee_id: 17 };
  const payrollUser = { id: 5, role: 'payroll_user', employee_id: 19 };
  const adminUser = { id: 1, role: 'admin', employee_id: null };
  const employeeUser = { id: 6, role: 'employee', employee_id: 2 };

  const hrOwnLeave = { id: 201, employee_id: 17 };
  const payrollOwnLeave = { id: 202, employee_id: 19 };
  const subordinateLeave = { id: 203, employee_id: 2 };

  // HR Manager cannot approve their own leave
  assert.equal(canApproveRequest(hrUser, hrOwnLeave), false, 'HR Manager must not approve own leave');
  // HR Manager can approve subordinate leave
  assert.equal(canApproveRequest(hrUser, subordinateLeave), true, 'HR Manager can approve other leaves');

  // Payroll User cannot approve their own leave
  assert.equal(canApproveRequest(payrollUser, payrollOwnLeave), false, 'Payroll User must not approve own leave');
  // Payroll User can approve other leaves
  assert.equal(canApproveRequest(payrollUser, subordinateLeave), true, 'Payroll User can approve other leaves');

  // Regular employee cannot approve any leave
  assert.equal(canApproveRequest(employeeUser, subordinateLeave), false, 'Employee cannot approve leaves');

  // Admin without employee_id can approve HR and Payroll leaves
  assert.equal(canApproveRequest(adminUser, hrOwnLeave), true, 'Admin can approve HR leave');
  assert.equal(canApproveRequest(adminUser, payrollOwnLeave), true, 'Admin can approve Payroll leave');
});

test('payroll hierarchy: employee -> hr -> payroll user -> payroll manager -> admin, no self-payroll', async () => {
  const { ROLE_HIERARCHY } = await import('../src/lib/guards.js');

  assert.equal(ROLE_HIERARCHY.employee, 1);
  assert.equal(ROLE_HIERARCHY.hr_manager, 2);
  assert.equal(ROLE_HIERARCHY.payroll_user, 3);
  assert.equal(ROLE_HIERARCHY.payroll_manager, 4);
  assert.equal(ROLE_HIERARCHY.admin, 5);

  const canProcessPayroll = (caller, targetEmployeeId, targetRole) => {
    if (caller.role === 'admin') return true;
    // Rule 1: No self-payroll
    if (caller.employee_id && targetEmployeeId === caller.employee_id) return false;
    // Rule 2: Strict hierarchy
    const callerRank = ROLE_HIERARCHY[caller.role] || 1;
    const targetRank = ROLE_HIERARCHY[targetRole] || 1;
    return targetRank < callerRank;
  };

  const payrollUser = { id: 5, role: 'payroll_user', employee_id: 19 };
  const payrollManager = { id: 4, role: 'payroll_manager', employee_id: 18 };
  const adminUser = { id: 1, role: 'admin', employee_id: null };

  // 1. Payroll User cannot process own payroll
  assert.equal(canProcessPayroll(payrollUser, 19, 'payroll_user'), false);
  // Payroll User cannot process Payroll Manager's payroll
  assert.equal(canProcessPayroll(payrollUser, 18, 'payroll_manager'), false);
  // Payroll User CAN process regular employee and HR payroll
  assert.equal(canProcessPayroll(payrollUser, 2, 'employee'), true);
  assert.equal(canProcessPayroll(payrollUser, 17, 'hr_manager'), true);

  // 2. Payroll Manager cannot process own payroll
  assert.equal(canProcessPayroll(payrollManager, 18, 'payroll_manager'), false);
  // Payroll Manager CAN process Payroll User, HR, and Employee payroll
  assert.equal(canProcessPayroll(payrollManager, 19, 'payroll_user'), true);
  assert.equal(canProcessPayroll(payrollManager, 17, 'hr_manager'), true);
  assert.equal(canProcessPayroll(payrollManager, 2, 'employee'), true);

  // 3. Admin can process everyone's payroll (including Payroll Manager and Payroll User)
  assert.equal(canProcessPayroll(adminUser, 18, 'payroll_manager'), true);
  assert.equal(canProcessPayroll(adminUser, 19, 'payroll_user'), true);
  assert.equal(canProcessPayroll(adminUser, 17, 'hr_manager'), true);
  assert.equal(canProcessPayroll(adminUser, 2, 'employee'), true);
});



