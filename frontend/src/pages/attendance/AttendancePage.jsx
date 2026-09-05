import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, Card, Table, Badge, Modal, Field, Alert, empNumberColumn } from '../../components/ui.jsx';

function formatDateTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function formatTimeOnly(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export default function AttendancePage() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isHRManager = user?.role === 'hr_manager';
  const isPayroll = user?.role === 'payroll_user' || user?.role === 'payroll_manager';
  const isEmployee = user?.role === 'employee';
  const isSelfOnly = isEmployee || isPayroll;
  const canManageAll = can('attendance', 'write') === 'all';

  const [searchParams, setSearchParams] = useSearchParams();
  const employeeIdFilter = searchParams.get('employee_id') || '';
  const effectiveEmpId = isSelfOnly && user?.employee_id ? String(user.employee_id) : employeeIdFilter;
  const statusFilter = searchParams.get('status') || '';
  const [missingOnly, setMissingOnly] = useState(false);

  // Modals & form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [quickActionLoading, setQuickActionLoading] = useState(false);

  // Reference data
  const employees = useApi(() => api.get('/employees'), []);

  // Filter available employees by role:
  // - Admin: all employees
  // - HR Manager: subordinates (where manager_id == user.employee_id) plus self (id == user.employee_id)
  // - Self-only (employee, payroll): only self
  const availableEmployees = useMemo(() => {
    const list = employees.data || [];
    if (isAdmin) return list;
    if (isHRManager) {
      return list.filter((emp) => emp.manager_id === user?.employee_id || emp.id === user?.employee_id);
    }
    if (isSelfOnly) {
      return list.filter((emp) => emp.id === user?.employee_id);
    }
    return list;
  }, [employees.data, isAdmin, isHRManager, isSelfOnly, user?.employee_id]);

  // Today status of active employee
  const { data: todayStatus, reload: reloadStatus } = useApi(
    () => api.get('/attendance/today-status'),
    []
  );

  // List of attendance records
  const { data: attendanceList, loading, error, reload } = useApi(
    () => {
      const q = new URLSearchParams();
      if (effectiveEmpId) q.set('employee_id', effectiveEmpId);
      if (statusFilter) q.set('status', statusFilter);
      if (missingOnly) q.set('missing_checkout', 'true');
      const qs = q.toString();
      return api.get(`/attendance${qs ? '?' + qs : ''}`);
    },
    [effectiveEmpId, statusFilter, missingOnly]
  );

  // Form fields
  const [form, setForm] = useState({
    employee_id: '',
    check_in: '',
    check_out: '',
    status: 'present',
    notes: '',
  });

  const isCheckedIn = todayStatus && !todayStatus.check_out;

  const handleQuickCheckInOut = async () => {
    setQuickActionLoading(true);
    try {
      if (isCheckedIn) {
        // Quick check out
        await api.post('/attendance/check-out', {});
      } else {
        // Quick check in
        await api.post('/attendance/check-in', {});
      }
      reloadStatus();
      reload();
    } catch (err) {
      alert(err.message || 'Check-in/out action failed');
    } finally {
      setQuickActionLoading(false);
    }
  };

  const handleQuickCheckOutRow = async (e, row) => {
    e.stopPropagation();
    try {
      await api.post(`/attendance/${row.id}/check-out`, {});
      reload();
      reloadStatus();
    } catch (err) {
      alert(err.message || 'Check-out failed');
    }
  };

  const openCreateModal = () => {
    setEditingRow(null);
    const nowIso = new Date().toISOString().slice(0, 16);
    const defaultEmpId = isSelfOnly && user?.employee_id
      ? String(user.employee_id)
      : (employeeIdFilter || (user?.employee_id ? String(user.employee_id) : ''));

    setForm({
      employee_id: defaultEmpId,
      check_in: nowIso,
      check_out: '',
      status: 'present',
      notes: '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (row) => {
    setEditingRow(row);
    const inIso = row.check_in ? new Date(row.check_in).toISOString().slice(0, 16) : '';
    const outIso = row.check_out ? new Date(row.check_out).toISOString().slice(0, 16) : '';
    setForm({
      employee_id: String(row.employee_id),
      check_in: inIso,
      check_out: outIso,
      status: row.status || 'present',
      notes: row.notes || '',
    });
    setFormError(null);
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!form.employee_id) {
      setFormError('Please select an employee.');
      return;
    }
    if (!form.check_in) {
      setFormError('Check-in time is required.');
      return;
    }
    if (form.check_out && new Date(form.check_out) < new Date(form.check_in)) {
      setFormError('Check-out time must be after check-in time.');
      return;
    }

    setSaving(true);
    const payload = {
      employee_id: Number(form.employee_id),
      check_in: new Date(form.check_in).toISOString(),
      check_out: form.check_out ? new Date(form.check_out).toISOString() : null,
      status: form.status,
      notes: form.notes || null,
    };

    try {
      if (editingRow) {
        await api.patch(`/attendance/${editingRow.id}`, payload);
      } else {
        await api.post('/attendance', payload);
      }
      setModalOpen(false);
      reload();
      reloadStatus();
    } catch (err) {
      setFormError(err.message || 'Failed to save attendance record');
    } finally {
      setSaving(false);
    }
  };

  // Missing checkout count
  const missingCheckoutCount = useMemo(() => {
    return (attendanceList || []).filter((r) => !r.check_out).length;
  }, [attendanceList]);

  const columns = useMemo(() => [
    empNumberColumn,
    {
      key: 'employee_name',
      label: 'Employee',
      render: (r) => (
        <div>
          {isSelfOnly ? (
            <span style={{ fontWeight: 600 }}>{r.employee_name}</span>
          ) : (
            <span
              className="clickable"
              style={{ fontWeight: 600, color: 'var(--accent)' }}
              onClick={(e) => {
                e.stopPropagation();
                setSearchParams({ employee_id: String(r.employee_id) });
              }}
            >
              {r.employee_name}
            </span>
          )}
          <div className="meta">{r.department_name || 'General'}</div>
        </div>
      ),
    },
    {
      key: 'date',
      label: 'Date',
      render: (r) => (r.check_in ? new Date(r.check_in).toLocaleDateString('en-IN') : '—'),
    },
    {
      key: 'check_in',
      label: 'Check In',
      render: (r) => formatTimeOnly(r.check_in),
    },
    {
      key: 'check_out',
      label: 'Check Out',
      render: (r) => {
        if (!r.check_out) {
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="badge badge-danger" style={{ fontSize: 11 }}>
                Missing Check-out
              </span>
              <button
                className="btn btn-sm"
                style={{ padding: '1px 6px', fontSize: 11 }}
                onClick={(e) => handleQuickCheckOutRow(e, r)}
              >
                Close Now
              </button>
            </div>
          );
        }
        return formatTimeOnly(r.check_out);
      },
    },
    {
      key: 'worked_hours',
      label: 'Worked Hours',
      align: 'right',
      render: (r) => {
        if (!r.check_out) return <span className="muted">In progress</span>;
        const h = Number(r.worked_hours || 0);
        return <strong>{h.toFixed(2)} hrs</strong>;
      },
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Badge value={r.status} />,
    },
    {
      key: 'manual_edit',
      label: 'Mode',
      render: (r) => (
        r.manual_edit ? (
          <span className="badge badge-warning" style={{ fontSize: 11 }}>
            HR Corrected
          </span>
        ) : (
          <span className="meta">Clock</span>
        )
      ),
    },
  ], [setSearchParams, isSelfOnly]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time & Attendance</h1>
          <p className="meta">Track working hours, overtime, half-days, and clock exceptions</p>
        </div>
        {!isAdmin && (
          <div className="row">
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Log Attendance Entry
            </button>
          </div>
        )}
      </div>

      {/* Quick Check-in / Check-out Banner (Hidden for Admin) */}
      {!isAdmin && (
        <Card
          className="card"
          style={{
            background: isCheckedIn ? '#ecfdf5' : 'var(--surface)',
            borderColor: isCheckedIn ? '#a7f3d0' : 'var(--border)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: isCheckedIn ? 'var(--success)' : 'var(--text)' }}>
                  {isCheckedIn ? '● Currently Checked In' : '○ Not Checked In'}
                </span>
                {isCheckedIn && (
                  <span className="badge badge-success">
                    Since {formatTimeOnly(todayStatus?.check_in)}
                  </span>
                )}
              </div>
              <p className="meta" style={{ marginTop: 4 }}>
                {isCheckedIn
                  ? `Logged in employee (${todayStatus?.employee_name || user?.name}). Click check out when your shift completes to derive worked hours.`
                  : 'Click check in to start tracking your working shift today.'}
              </p>
            </div>

            <button
              className={`btn ${isCheckedIn ? 'btn-danger' : 'btn-primary'}`}
              style={{ minWidth: 160, padding: '10px 18px', fontWeight: 600 }}
              disabled={quickActionLoading}
              onClick={handleQuickCheckInOut}
            >
              {quickActionLoading ? 'Processing...' : isCheckedIn ? 'Check Out Now' : 'Check In Now'}
            </button>
          </div>
        </Card>
      )}

      {/* Exception Warning Banner */}
      {missingCheckoutCount > 0 && (
        <Alert level="warning">
          <strong>Attendance Exceptions</strong>: {missingCheckoutCount} record(s) have missing check-outs.
          Click any row to provide corrections or click "Close Now" to record check-out.
        </Alert>
      )}

      <div style={{ height: 12 }} />

      <Card className="card" title="Filter Records">
        <div className={!isSelfOnly ? "grid grid-2" : "grid"}>
          {!isSelfOnly && (
            <div className="field">
              <label>Employee</label>
              <select
                className="select"
                value={employeeIdFilter}
                onChange={(e) => {
                  const next = new URLSearchParams(searchParams);
                  if (e.target.value) next.set('employee_id', e.target.value);
                  else next.delete('employee_id');
                  setSearchParams(next);
                }}
              >
                <option value="">{isHRManager ? 'All My Team Members & Self' : 'All Employees'}</option>
                {availableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} {emp.id === user?.employee_id ? '(You)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="field">
            <label>Status</label>
            <select
              className="select"
              value={statusFilter}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set('status', e.target.value);
                else next.delete('status');
                setSearchParams(next);
              }}
            >
              <option value="">All Statuses</option>
              <option value="present">Present (Standard)</option>
              <option value="overtime">Overtime (&gt; 9 hrs)</option>
              <option value="half_day">Half Day (&lt; 4 hrs)</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
            </select>
          </div>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={missingOnly}
              onChange={(e) => setMissingOnly(e.target.checked)}
            />
            <span>Show Missing Check-outs Only ({missingCheckoutCount})</span>
          </label>

          {(employeeIdFilter || statusFilter || missingOnly) && (
            <button
              className="btn btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => {
                setSearchParams({});
                setMissingOnly(false);
              }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </Card>

      <div style={{ height: 20 }} />

      <States loading={loading} error={error} empty={!attendanceList?.length} onRetry={reload}>
        <Card pad={false}>
          <Table columns={columns} rows={attendanceList || []} onRowClick={openEditModal} />
        </Card>
      </States>

      {/* Create / Edit Attendance Modal */}
      {modalOpen && (
        <Modal
          title={editingRow ? `Correct Attendance: ${editingRow.employee_name}` : 'Log Attendance Entry'}
          onClose={() => setModalOpen(false)}
          width={540}
        >
          <form onSubmit={handleSave} style={{ display: 'grid', gap: 16 }}>
            {formError && <Alert level="error">{formError}</Alert>}

            {editingRow && (
              <Alert level="info">
                <strong>HR Correction Mode</strong>: Editing this attendance record will automatically mark it as a
                manual edit with an audit flag.
              </Alert>
            )}

            <fieldset disabled={isSelfOnly && Boolean(editingRow)} style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
            <Field label="Employee *">
              <select
                className="select"
                value={form.employee_id}
                onChange={(e) => setForm({ ...form, employee_id: e.target.value })}
                disabled={Boolean(editingRow) || isSelfOnly}
                required
              >
                {!isSelfOnly && <option value="">Select Employee...</option>}
                {availableEmployees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} {emp.id === user?.employee_id ? '(You)' : ''}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-2">
              <Field label="Check-In Time *">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.check_in}
                  onChange={(e) => setForm({ ...form, check_in: e.target.value })}
                  required
                />
              </Field>

              <Field label="Check-Out Time (Optional)">
                <input
                  className="input"
                  type="datetime-local"
                  value={form.check_out}
                  onChange={(e) => setForm({ ...form, check_out: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Status Classification">
              <select
                className="select"
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
              >
                <option value="present">Present (Normal)</option>
                <option value="overtime">Overtime (&gt; 9h)</option>
                <option value="half_day">Half Day (&lt; 4h)</option>
                <option value="late">Late Arrival</option>
                <option value="absent">Absent</option>
              </select>
            </Field>

            <Field label="Notes / Reason for correction">
              <input
                className="input"
                type="text"
                placeholder="e.g. Card forgotten, corrected shift timing"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </Field>

            </fieldset>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                {isSelfOnly && editingRow ? 'Close' : 'Cancel'}
              </button>
              {(!isSelfOnly || !editingRow) && (
                <button type="submit" className="btn btn-primary" disabled={saving}>
                  {saving ? 'Saving...' : editingRow ? 'Save Correction' : 'Log Entry'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
