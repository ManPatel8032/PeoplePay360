import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, Card, Table, Badge, Modal, Field, Alert, empNumberColumn, SearchInput } from '../../components/ui.jsx';


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

function toLocalDatetimeString(dateInput) {
  if (!dateInput) return '';
  const d = new Date(dateInput);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const searchFilter = searchParams.get('search') || '';
  const isMissingFromUrl = statusFilter === 'missing_checkout' || searchParams.get('missing_checkout') === 'true';
  const [missingOnly, setMissingOnly] = useState(isMissingFromUrl);

  useEffect(() => {
    setMissingOnly(isMissingFromUrl);
  }, [isMissingFromUrl]);

  // Modals & form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [quickActionLoading, setQuickActionLoading] = useState(false);

  // Reference data
  const employees = useApi(() => api.get('/employees'), []);

  // /employees is already scoped by the server to what this role may see, so the
  // page must not re-derive visibility from the org chart — that walk disagreed
  // with the permission matrix, which is the single source of truth. The only
  // narrowing left to the UI is for roles that may record attendance for
  // themselves alone.
  const availableEmployees = useMemo(() => {
    const list = employees.data || [];
    if (can('attendance', 'write') === 'own' && user?.employee_id) {
      return list.filter((emp) => emp.id === user.employee_id);
    }
    return list;
  }, [employees.data, can, user?.employee_id]);

  // Today status of active employee
  const { data: todayStatus, reload: reloadStatus } = useApi(
    () => api.get('/attendance/today-status'),
    []
  );

  // List of attendance records
  const isMissingActive = missingOnly || statusFilter === 'missing_checkout';

  const { data: attendanceRes, loading, error, reload } = useApi(
    () => {
      const q = new URLSearchParams();
      if (effectiveEmpId) q.set('employee_id', effectiveEmpId);
      if (statusFilter && statusFilter !== 'missing_checkout') q.set('status', statusFilter);
      if (isMissingActive) q.set('missing_checkout', 'true');
      if (searchFilter) q.set('search', searchFilter);
      const qs = q.toString();
      return api.get(`/attendance${qs ? '?' + qs : ''}`);
    },
    [effectiveEmpId, statusFilter, isMissingActive, searchFilter]
  );

  const attendanceList = Array.isArray(attendanceRes) ? attendanceRes : (attendanceRes?.data || []);

  // Total missing count across scope from dedicated endpoint
  const { data: missingCountData, reload: reloadMissingCount } = useApi(
    () => {
      const q = new URLSearchParams();
      if (effectiveEmpId) q.set('employee_id', effectiveEmpId);
      const qs = q.toString();
      return api.get(`/attendance/missing-count${qs ? '?' + qs : ''}`);
    },
    [effectiveEmpId]
  );
  const missingCheckoutCount = missingCountData?.count ?? (
    (attendanceList || []).filter((r) => !r.check_out).length
  );

  // Form fields
  const [form, setForm] = useState({
    employee_id: '',
    check_in: '',
    check_out: '',
    status: 'present',
    notes: '',
  });

  // Validation / Notice popup modal
  const [infoModal, setInfoModal] = useState({ open: false, title: '', message: '', type: 'info' });

  const isCheckedIn = Boolean(todayStatus && !todayStatus.check_out);

  const handleCheckInClick = async () => {
    if (isCheckedIn) {
      setInfoModal({
        open: true,
        title: 'Already Checked In',
        message: `You are already checked in since ${formatTimeOnly(todayStatus?.check_in)}. Click "Check Out" when your shift is completed.`,
        type: 'warning',
      });
      return;
    }

    setQuickActionLoading(true);
    try {
      await api.post('/attendance/check-in', {});
      reloadStatus();
      reload();
    } catch (err) {
      setInfoModal({
        open: true,
        title: 'Check-In Notice',
        message: err.message || 'Check-in failed',
        type: 'error',
      });
    } finally {
      setQuickActionLoading(false);
    }
  };

  const handleCheckOutClick = async () => {
    if (!isCheckedIn) {
      setInfoModal({
        open: true,
        title: 'You have not checked in',
        message: 'You cannot check out because you have not checked in yet. Please click "Check In" first to begin your shift.',
        type: 'warning',
      });
      return;
    }

    setQuickActionLoading(true);
    try {
      await api.post('/attendance/check-out', {});
      reloadStatus();
      reload();
    } catch (err) {
      setInfoModal({
        open: true,
        title: 'Check-Out Notice',
        message: err.message || 'Check-out failed',
        type: 'error',
      });
    } finally {
      setQuickActionLoading(false);
    }
  };

  const [closingMissed, setClosingMissed] = useState(false);

  const handleCloseAllMissedCheckouts = async () => {
    setClosingMissed(true);
    try {
      const res = await api.post('/attendance/close-missed-checkouts', {});
      setInfoModal({
        open: true,
        title: 'Missed Check-outs Closed',
        message: res.message || 'All missed check-out records have been closed with standard 8-hour shifts.',
        type: 'info',
      });
      reload();
      reloadStatus();
      reloadMissingCount();
    } catch (err) {
      setInfoModal({
        open: true,
        title: 'Error Closing Missed Check-outs',
        message: err.message || 'Failed to close missed check-outs',
        type: 'error',
      });
    } finally {
      setClosingMissed(false);
    }
  };

  const toggleMissedFilter = () => {
    const nextVal = !isMissingActive;
    setMissingOnly(nextVal);
    const next = new URLSearchParams(searchParams);
    if (nextVal) {
      next.set('missing_checkout', 'true');
      next.delete('status');
    } else {
      next.delete('missing_checkout');
      if (next.get('status') === 'missing_checkout') next.delete('status');
    }
    setSearchParams(next);
  };

  const handleQuickCheckOutRow = async (e, row) => {
    e.stopPropagation();
    try {
      await api.post(`/attendance/${row.id}/check-out`, {});
      reload();
      reloadStatus();
      reloadMissingCount();
    } catch (err) {
      setInfoModal({
        open: true,
        title: 'Check-Out Notice',
        message: err.message || 'Check-out failed',
        type: 'error',
      });
    }
  };

  const openCreateModal = () => {
    setEditingRow(null);
    const nowIso = toLocalDatetimeString(new Date());
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
    const inIso = row.check_in ? toLocalDatetimeString(row.check_in) : '';
    const outIso = row.check_out ? toLocalDatetimeString(row.check_out) : '';
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
          const isOwnRecord = Number(r.employee_id) === Number(user?.employee_id);
          const isStale = isMissingActive || (Date.now() - new Date(r.check_in).getTime() > 16 * 3600 * 1000);
          const canClose = isOwnRecord || isHRManager || isAdmin;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {isStale ? (
                <span className="badge badge-danger" style={{ fontSize: 11 }}>
                  Missing Check-out
                </span>
              ) : (
                <span className="badge badge-info" style={{ fontSize: 11 }}>
                  ● In Progress
                </span>
              )}
              {isStale && canClose && (
                <button
                  className="btn btn-sm btn-danger"
                  style={{ padding: '2px 8px', fontSize: 11, fontWeight: 600 }}
                  onClick={(e) => handleQuickCheckOutRow(e, r)}
                  title="Close missed check-out"
                >
                  Close Now
                </button>
              )}
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
          <span className="meta">Manual</span>
        )
      ),
    },
  ], [setSearchParams, isSelfOnly, user?.employee_id, missingOnly, statusFilter, isHRManager, isAdmin]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time & Attendance</h1>
          <p className="meta">Track working hours, overtime, half-days, and clock exceptions</p>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {(missingCheckoutCount > 0 || isMissingActive) && (
            <>
              <button
                id="btn-head-filter-missed"
                className={`btn ${isMissingActive ? 'btn-danger' : 'btn-outline'}`}
                style={{ fontWeight: 600 }}
                onClick={toggleMissedFilter}
              >
                {isMissingActive ? `✓ Showing Missed (${missingCheckoutCount})` : `Filter Missed Check-outs (${missingCheckoutCount})`}
              </button>
              {missingCheckoutCount > 0 && (
                <button
                  id="btn-head-close-all"
                  className="btn btn-danger"
                  style={{ fontWeight: 600 }}
                  disabled={closingMissed}
                  onClick={handleCloseAllMissedCheckouts}
                >
                  {closingMissed ? 'Closing...' : `Close All Missed Check-outs (${missingCheckoutCount})`}
                </button>
              )}
            </>
          )}
          {!isAdmin && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + Log Attendance Entry
            </button>
          )}
        </div>
      </div>

      {/* Quick Check-in / Check-out Banner (Hidden for Admin) */}
      {!isAdmin && (
        <Card
          className="card"
          style={{
            background: isCheckedIn ? '#ecfdf5' : todayStatus?.check_out ? '#f0fdf4' : 'var(--surface)',
            borderColor: isCheckedIn ? '#a7f3d0' : todayStatus?.check_out ? '#bbf7d0' : 'var(--border)',
            marginBottom: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    color: isCheckedIn ? 'var(--success)' : todayStatus?.check_out ? 'var(--success)' : 'var(--text)',
                  }}
                >
                  {isCheckedIn
                    ? '● Currently Checked In'
                    : todayStatus?.check_out
                      ? '✓ Shift Completed Today'
                      : '○ Not Checked In Today'}
                </span>
                {todayStatus?.check_in && (
                  <span className="badge badge-success">
                    In: {formatTimeOnly(todayStatus.check_in)}
                  </span>
                )}
                {todayStatus?.check_out && (
                  <span className="badge badge-info">
                    Out: {formatTimeOnly(todayStatus.check_out)}
                  </span>
                )}
                {todayStatus?.worked_hours && (
                  <span className="badge badge-primary" style={{ fontWeight: 600 }}>
                    Worked Today: {Number(todayStatus.worked_hours).toFixed(2)} hrs
                  </span>
                )}
                {todayStatus?.status && (
                  <Badge value={todayStatus.status} />
                )}
              </div>
              <p className="meta" style={{ marginTop: 6, marginBottom: 0 }}>
                {isCheckedIn
                  ? `Active shift for ${todayStatus?.employee_name || user?.name} started at ${formatTimeOnly(todayStatus?.check_in)}. Click "Check Out" when your shift completes to calculate worked hours.`
                  : todayStatus?.check_out
                    ? `Shift ended at ${formatTimeOnly(todayStatus.check_out)} with ${Number(todayStatus.worked_hours || 0).toFixed(2)} hrs worked today. Click "Check In" if starting another shift.`
                    : 'You have not checked in today. Click "Check In" to start tracking your working shift today.'}
              </p>
            </div>

            <div className="row" style={{ gap: 10 }}>
              <button
                id="btn-check-in"
                className="btn btn-primary"
                style={{ minWidth: 120, padding: '10px 18px', fontWeight: 600 }}
                disabled={quickActionLoading}
                onClick={handleCheckInClick}
              >
                {quickActionLoading ? 'Processing...' : 'Check In'}
              </button>

              <button
                id="btn-check-out"
                className="btn btn-danger"
                style={{ minWidth: 120, padding: '10px 18px', fontWeight: 600 }}
                disabled={quickActionLoading}
                onClick={handleCheckOutClick}
              >
                {quickActionLoading ? 'Processing...' : 'Check Out'}
              </button>
            </div>
          </div>
        </Card>
      )}

      <Card className="card" title="Filter Records">
        <div style={{ marginBottom: 14 }}>
          <SearchInput
            placeholder="Search attendance by employee name..."
            value={searchFilter}
            onChange={(val) => {
              const current = searchParams.get('search') || '';
              if ((val || '') === current) return;
              const next = new URLSearchParams(searchParams);
              if (val) next.set('search', val);
              else next.delete('search');
              setSearchParams(next);
            }}
          />
        </div>

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
              value={isMissingActive ? 'missing_checkout' : statusFilter}
              onChange={(e) => {
                const val = e.target.value;
                const next = new URLSearchParams(searchParams);
                next.delete('missing_checkout');
                if (val === 'missing_checkout') {
                  setMissingOnly(true);
                  next.set('missing_checkout', 'true');
                  next.delete('status');
                } else {
                  setMissingOnly(false);
                  if (val) next.set('status', val);
                  else next.delete('status');
                }
                setSearchParams(next);
              }}
            >
              <option value="">All Statuses</option>
              <option value="missing_checkout">Missing Check-out ({missingCheckoutCount})</option>
              <option value="present">Present (Full Day: 8 - 9 hrs)</option>
              <option value="overtime">Overtime (&gt; 9 hrs)</option>
              <option value="half_day">Half Day (&gt; 4 to &lt; 8 hrs)</option>
              <option value="late">Late</option>
              <option value="absent">Absent (&le; 4 hrs)</option>
            </select>
          </div>
        </div>

        {(employeeIdFilter || statusFilter || isMissingActive || searchFilter) && (
          <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                setSearchParams({});
                setMissingOnly(false);
              }}
            >
              Reset Filters
            </button>
          </div>
        )}
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
                <option value="present">Present (Full Day: 8 - 9h)</option>
                <option value="overtime">Overtime (&gt; 9h)</option>
                <option value="half_day">Half Day (&gt; 4 to &lt; 8h)</option>
                <option value="late">Late Arrival</option>
                <option value="absent">Absent (&le; 4h)</option>
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

      {/* Notice / Validation Popup Modal */}
      {infoModal.open && (
        <Modal
          title={infoModal.title}
          onClose={() => setInfoModal((prev) => ({ ...prev, open: false }))}
          width={440}
        >
          <div style={{ display: 'grid', gap: 16 }}>
            <Alert level={infoModal.type === 'error' ? 'error' : infoModal.type === 'warning' ? 'warning' : 'info'}>
              {infoModal.message}
            </Alert>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
              <button
                id="btn-close-notice"
                className="btn btn-primary"
                onClick={() => setInfoModal((prev) => ({ ...prev, open: false }))}
              >
                OK
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
