import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, Card, Table, Badge, Modal, Field, Alert, empNumberColumn, SearchInput } from '../../components/ui.jsx';

import LeaveBalanceWidget from '../../components/LeaveBalanceWidget.jsx';

const TODAY = new Date().toISOString().slice(0, 10);

export default function TimeOffPage() {
  const { user, can } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isEmployee = user?.role === 'employee';
  const canApprove = can('timeoff_approve', 'write') !== 'none';
  const canWriteAllocations = can('allocations', 'write') === 'all';
  const canWriteTypes = can('timeoff', 'write') === 'all';

  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'requests';
  const employeeIdFilter = searchParams.get('employee_id') || '';
  const effectiveEmpId = isEmployee && user?.employee_id ? String(user.employee_id) : employeeIdFilter;

  const setTab = (tab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next);
  };

  // Reference data
  const employees = useApi(() => api.get('/employees'), []);
  const typesData = useApi(() => api.get('/time-off/types'), []);

  // Selected employee for balance preview
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(
    isEmployee && user?.employee_id ? String(user.employee_id) : (employeeIdFilter || '')
  );
  const [balanceKey, setBalanceKey] = useState(0);

  useEffect(() => {
    if (isEmployee && user?.employee_id) {
      setSelectedEmployeeId(String(user.employee_id));
    } else if (employeeIdFilter) {
      setSelectedEmployeeId(employeeIdFilter);
    } else if (employees.data?.length && !selectedEmployeeId) {
      setSelectedEmployeeId(String(employees.data[0].id));
    }
  }, [employeeIdFilter, employees.data, isEmployee, user?.employee_id]);

  // =================== REQUESTS TAB ===================
  const urlReqState = searchParams.get('state');
  const [requestFilterState, setRequestFilterState] = useState(urlReqState || 'all'); // 'all', 'to_approve', 'approved', 'refused'

  useEffect(() => {
    const s = searchParams.get('state');
    if (s && s !== requestFilterState) {
      setRequestFilterState(s);
    }
  }, [searchParams]);
  const [requestSearch, setRequestSearch] = useState('');
  const [newRequestModalOpen, setNewRequestModalOpen] = useState(false);
  const [reqSaving, setReqSaving] = useState(false);
  const [reqFormError, setReqFormError] = useState(null);

  const { data: requests, loading: reqLoading, error: reqError, reload: reloadRequests, setData: setRequestsData } = useApi(
    () => {
      const q = new URLSearchParams();
      if (effectiveEmpId) q.set('employee_id', effectiveEmpId);
      if (requestFilterState === 'to_approve') q.set('state', 'to_approve');
      else if (requestFilterState === 'approved') q.set('state', 'approved');
      else if (requestFilterState === 'refused') q.set('state', 'refused');
      else if (requestFilterState === 'cancelled') q.set('state', 'cancelled');
      if (requestSearch) q.set('search', requestSearch);
      const qs = q.toString();
      return api.get(`/time-off/requests${qs ? '?' + qs : ''}`);
    },
    [effectiveEmpId, requestFilterState, requestSearch]
  );


  // New Request Form
  const [reqForm, setReqForm] = useState({
    employee_id: '',
    type_id: '',
    date_from: TODAY,
    date_to: TODAY,
    duration: '1',
    reason: '',
  });

  // Calculate duration from date_from and date_to
  const calculateDays = (from, to) => {
    if (!from || !to || to < from) return 1;
    const [y1, m1, d1] = from.split('-').map(Number);
    const [y2, m2, d2] = to.split('-').map(Number);
    const date1 = Date.UTC(y1, m1 - 1, d1);
    const date2 = Date.UTC(y2, m2 - 1, d2);
    const diffDays = Math.round((date2 - date1) / (1000 * 60 * 60 * 24));
    return Math.max(1, diffDays + 1);
  };

  // Calculate date_to from date_from and duration (e.g. 1 day starting 2026-09-01 ends 2026-09-01)
  const calculateDateTo = (from, duration) => {
    if (!from) return TODAY;
    const dur = parseFloat(duration);
    if (isNaN(dur) || dur <= 0) return from;
    const [y, m, d] = from.split('-').map(Number);
    if (!y || !m || !d) return from;
    const dt = new Date(Date.UTC(y, m - 1, d));
    const daysToAdd = Math.max(0, Math.ceil(dur) - 1);
    dt.setUTCDate(dt.getUTCDate() + daysToAdd);
    return dt.toISOString().slice(0, 10);
  };

  const handleReqFieldChange = (field, val) => {
    const next = { ...reqForm, [field]: val };
    if (field === 'duration') {
      if (next.date_from && val && !isNaN(val) && Number(val) > 0) {
        next.date_to = calculateDateTo(next.date_from, val);
      }
    } else if (field === 'date_from') {
      if (val) {
        next.date_to = calculateDateTo(val, next.duration);
      }
    } else if (field === 'date_to') {
      if (next.date_from && val) {
        const dur = calculateDays(next.date_from, val);
        next.duration = String(dur);
      }
    }
    setReqForm(next);
  };

  const openNewRequestModal = () => {
    setReqForm({
      employee_id: isEmployee && user?.employee_id ? String(user.employee_id) : (selectedEmployeeId || effectiveEmpId || (employees.data?.[0]?.id ? String(employees.data[0].id) : '')),
      type_id: typesData.data?.[0]?.id ? String(typesData.data[0].id) : '',
      date_from: TODAY,
      date_to: TODAY,
      duration: '1',
      reason: '',
    });
    setReqFormError(null);
    setNewRequestModalOpen(true);
  };

  const handleSaveRequest = async (e) => {
    e.preventDefault();
    setReqFormError(null);

    if (!reqForm.employee_id) return setReqFormError('Employee is required');
    if (!reqForm.type_id) return setReqFormError('Leave type is required');
    if (!reqForm.date_from || !reqForm.date_to) return setReqFormError('Dates are required');
    if (reqForm.date_to < reqForm.date_from) return setReqFormError('Date to must be on or after Date from');

    setReqSaving(true);
    try {
      const res = await api.post('/time-off/requests', {
        employee_id: Number(reqForm.employee_id),
        type_id: Number(reqForm.type_id),
        date_from: reqForm.date_from,
        date_to: reqForm.date_to,
        duration: Number(reqForm.duration),
        reason: reqForm.reason || null,
      });

      setNewRequestModalOpen(false);
      reloadRequests();
      setBalanceKey((k) => k + 1); // trigger live balance update
    } catch (err) {
      setReqFormError(err.message || 'Failed to submit time off request');
    } finally {
      setReqSaving(false);
    }
  };

  // Immediate balance drop and state update on approve
  const handleApproveRequest = async (e, r) => {
    e.stopPropagation();
    try {
      const res = await api.post(`/time-off/requests/${r.id}/approve`, {});
      // Instantly update request item state in local table
      if (requests) {
        setRequestsData(requests.map((item) => (item.id === r.id ? { ...item, state: 'approved' } : item)));
      }
      // Instantly trigger balance widget reload
      setBalanceKey((k) => k + 1);
    } catch (err) {
      alert(err.message || 'Approval failed');
    }
  };

  const handleRefuseRequest = async (e, r) => {
    e.stopPropagation();
    try {
      await api.post(`/time-off/requests/${r.id}/refuse`, {});
      if (requests) {
        setRequestsData(requests.map((item) => (item.id === r.id ? { ...item, state: 'refused' } : item)));
      }
      setBalanceKey((k) => k + 1);
    } catch (err) {
      alert(err.message || 'Refusal failed');
    }
  };

  const handleCancelRequest = async (e, r) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to cancel this leave request?')) return;
    try {
      await api.post(`/time-off/requests/${r.id}/cancel`, {});
      if (requests) {
        setRequestsData(requests.map((item) => (item.id === r.id ? { ...item, state: 'cancelled' } : item)));
      }
      setBalanceKey((k) => k + 1);
      reloadRequests();
    } catch (err) {
      alert(err.message || 'Cancellation failed');
    }
  };

  const pendingRequestsCount = useMemo(() => {
    return (requests || []).filter((r) => r.state === 'to_approve').length;
  }, [requests]);

  const requestColumns = useMemo(() => [
    empNumberColumn,
    {
      key: 'employee_name',
      label: 'Employee',
      render: (r) => <strong>{r.employee_name}</strong>,
    },
    {
      key: 'type_name',
      label: 'Type',
      render: (r) => (
        <span
          className="badge"
          style={{
            borderLeft: `4px solid ${r.type_color || 'var(--accent)'}`,
            fontWeight: 600,
          }}
        >
          {r.type_name} {!r.is_paid && <span style={{ color: 'var(--danger)', marginLeft: 4 }}>(Unpaid)</span>}
        </span>
      ),
    },
    {
      key: 'dates',
      label: 'Dates',
      render: (r) => (
        <span>
          {r.date_from} <span className="muted">→</span> {r.date_to}
        </span>
      ),
    },
    {
      key: 'duration',
      label: 'Duration',
      render: (r) => <span>{r.duration} {r.unit || 'day'}(s)</span>,
    },
    {
      key: 'reason',
      label: 'Reason',
      render: (r) => <span className="meta">{r.reason || '—'}</span>,
    },
    {
      key: 'state',
      label: 'Status',
      render: (r) => <Badge value={r.state} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (r) => {
        const isOwn = isEmployee || (user?.employee_id && r.employee_id === user.employee_id);
        const canCancel = (r.state === 'to_approve' || r.state === 'approved') && (isOwn || canApprove);

        if (r.state === 'to_approve' && canApprove) {
          return (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
              <button
                className="btn btn-sm btn-primary"
                style={{ background: 'var(--success)', borderColor: 'var(--success)' }}
                onClick={(e) => handleApproveRequest(e, r)}
              >
                ✓ Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={(e) => handleRefuseRequest(e, r)}
              >
                ✕ Refuse
              </button>
              <button
                className="btn btn-sm"
                style={{ color: 'var(--danger)', borderColor: '#fca5a5', background: '#fef2f2' }}
                onClick={(e) => handleCancelRequest(e, r)}
                title="Cancel leave request"
              >
                Cancel
              </button>
            </div>
          );
        }

        if (canCancel) {
          return (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, alignItems: 'center' }}>
              <span className="meta">
                {r.approver_name ? `By ${r.approver_name}` : r.state === 'to_approve' ? 'Pending Approval' : ''}
              </span>
              <button
                className="btn btn-sm"
                style={{
                  color: 'var(--danger)',
                  borderColor: '#fca5a5',
                  background: '#fef2f2',
                  padding: '3px 8px',
                  fontWeight: 600,
                }}
                onClick={(e) => handleCancelRequest(e, r)}
              >
                ✕ Cancel Leave
              </button>
            </div>
          );
        }

        return (
          <span className="meta">
            {r.approver_name ? `By ${r.approver_name}` : r.state === 'to_approve' ? 'Pending Approval' : r.state === 'cancelled' ? 'Cancelled' : '—'}
          </span>
        );
      },
    },
  ], [requests, canApprove, isEmployee, user?.employee_id]);


  // =================== ALLOCATIONS TAB ===================
  const [newAllocModalOpen, setNewAllocModalOpen] = useState(false);
  const [allocSaving, setAllocSaving] = useState(false);
  const [allocFormError, setAllocFormError] = useState(null);

  const { data: allocations, loading: allocLoading, error: allocError, reload: reloadAllocations, setData: setAllocationsData } = useApi(
    () => {
      const q = new URLSearchParams();
      if (effectiveEmpId) q.set('employee_id', effectiveEmpId);
      const qs = q.toString();
      return api.get(`/time-off/allocations${qs ? '?' + qs : ''}`);
    },
    [effectiveEmpId, activeTab]
  );

  const [allocForm, setAllocForm] = useState({
    employee_id: '',
    type_id: '',
    amount: '18',
    state: 'approved',
    valid_from: TODAY,
    valid_to: '',
    note: '',
  });

  const openNewAllocModal = () => {
    setAllocForm({
      employee_id: selectedEmployeeId || employeeIdFilter || (employees.data?.[0]?.id ? String(employees.data[0].id) : ''),
      type_id: typesData.data?.[0]?.id ? String(typesData.data[0].id) : '',
      amount: '18',
      state: 'approved',
      valid_from: TODAY,
      valid_to: '',
      note: 'Annual Leave Grant',
    });
    setAllocFormError(null);
    setNewAllocModalOpen(true);
  };

  const handleSaveAllocation = async (e) => {
    e.preventDefault();
    setAllocFormError(null);

    if (!allocForm.employee_id) return setAllocFormError('Employee is required');
    if (!allocForm.type_id) return setAllocFormError('Type is required');
    if (Number(allocForm.amount) <= 0) return setAllocFormError('Amount must be greater than 0');
    if (!allocForm.valid_from) return setAllocFormError('Valid from date is required');

    setAllocSaving(true);
    try {
      await api.post('/time-off/allocations', {
        employee_id: Number(allocForm.employee_id),
        type_id: Number(allocForm.type_id),
        amount: Number(allocForm.amount),
        state: allocForm.state,
        valid_from: allocForm.valid_from,
        valid_to: allocForm.valid_to || null,
        note: allocForm.note || null,
      });
      setNewAllocModalOpen(false);
      reloadAllocations();
      setBalanceKey((k) => k + 1);
    } catch (err) {
      setAllocFormError(err.message || 'Failed to create allocation');
    } finally {
      setAllocSaving(false);
    }
  };

  const handleApproveAlloc = async (r) => {
    try {
      await api.post(`/time-off/allocations/${r.id}/approve`, {});
      if (allocations) {
        setAllocationsData(allocations.map((item) => (item.id === r.id ? { ...item, state: 'approved' } : item)));
      }
      setBalanceKey((k) => k + 1);
    } catch (err) {
      alert(err.message || 'Failed to approve allocation');
    }
  };

  const handleRefuseAlloc = async (r) => {
    try {
      await api.post(`/time-off/allocations/${r.id}/refuse`, {});
      if (allocations) {
        setAllocationsData(allocations.map((item) => (item.id === r.id ? { ...item, state: 'refused' } : item)));
      }
      setBalanceKey((k) => k + 1);
    } catch (err) {
      alert(err.message || 'Failed to refuse allocation');
    }
  };

  const allocationColumns = useMemo(() => [
    empNumberColumn,
    {
      key: 'employee_name',
      label: 'Employee',
      render: (r) => <strong>{r.employee_name}</strong>,
    },
    {
      key: 'type_name',
      label: 'Leave Type',
      render: (r) => (
        <span className="badge" style={{ borderLeft: `4px solid ${r.type_color || 'var(--accent)'}` }}>
          {r.type_name}
        </span>
      ),
    },
    {
      key: 'amount',
      label: 'Allocated',
      render: (r) => `${r.amount} ${r.unit}(s)`,
    },
    {
      key: 'taken',
      label: 'Taken',
      render: (r) => `${r.taken} ${r.unit}(s)`,
    },
    {
      key: 'remaining',
      label: 'Remaining',
      render: (r) => (
        <strong style={{ color: r.state === 'approved' ? 'var(--success)' : 'var(--text-muted)' }}>
          {r.state === 'approved' ? `${r.remaining} ${r.unit}(s)` : 'Pending Approval'}
        </strong>
      ),
    },
    {
      key: 'validity',
      label: 'Validity',
      render: (r) => `${r.valid_from} → ${r.valid_to || 'Indefinite'}`,
    },
    {
      key: 'state',
      label: 'State',
      render: (r) => <Badge value={r.state} />,
    },
    {
      key: 'actions',
      label: 'Actions',
      align: 'right',
      render: (r) => {
        if (r.state === 'draft') {
          return (
            <div className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
              <button
                className="btn btn-sm btn-primary"
                style={{ background: 'var(--success)', borderColor: 'var(--success)' }}
                onClick={() => handleApproveAlloc(r)}
              >
                Approve
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={() => handleRefuseAlloc(r)}
              >
                Refuse
              </button>
            </div>
          );
        }
        return <span className="meta">{r.note || '—'}</span>;
      },
    },
  ], [allocations]);


  // =================== LEAVE TYPES TAB ===================
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState(null);
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeFormError, setTypeFormError] = useState(null);

  const [typeForm, setTypeForm] = useState({
    name: '',
    code: '',
    unit: 'day',
    requires_allocation: true,
    requires_approval: true,
    is_paid: true,
    color: '#4f46e5',
  });

  const openCreateTypeModal = () => {
    setEditingType(null);
    setTypeForm({
      name: '',
      code: '',
      unit: 'day',
      requires_allocation: true,
      requires_approval: true,
      is_paid: true,
      color: '#4f46e5',
    });
    setTypeFormError(null);
    setTypeModalOpen(true);
  };

  const openEditTypeModal = (t) => {
    setEditingType(t);
    setTypeForm({
      name: t.name,
      code: t.code,
      unit: t.unit,
      requires_allocation: t.requires_allocation,
      requires_approval: t.requires_approval,
      is_paid: t.is_paid,
      color: t.color,
    });
    setTypeFormError(null);
    setTypeModalOpen(true);
  };

  const handleSaveType = async (e) => {
    e.preventDefault();
    setTypeFormError(null);
    if (!typeForm.name.trim()) return setTypeFormError('Name is required');
    if (!typeForm.code.trim()) return setTypeFormError('Code is required');

    setTypeSaving(true);
    try {
      if (editingType) {
        await api.patch(`/time-off/types/${editingType.id}`, typeForm);
      } else {
        await api.post('/time-off/types', typeForm);
      }
      setTypeModalOpen(false);
      typesData.reload();
    } catch (err) {
      setTypeFormError(err.message || 'Failed to save leave type');
    } finally {
      setTypeSaving(false);
    }
  };

  const typeColumns = useMemo(() => [
    {
      key: 'name',
      label: 'Leave Type Name',
      render: (t) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: 99, background: t.color || 'var(--accent)' }} />
          <strong>{t.name}</strong>
        </div>
      ),
    },
    {
      key: 'code',
      label: 'Code',
      render: (t) => <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{t.code}</span>,
    },
    {
      key: 'unit',
      label: 'Unit',
      render: (t) => <Badge value={t.unit} />,
    },
    {
      key: 'paid',
      label: 'Paid / Unpaid',
      render: (t) => (
        t.is_paid ? (
          <span className="badge badge-success">Paid (Standard)</span>
        ) : (
          <span className="badge badge-danger">Unpaid (LOP Deduction in Payroll)</span>
        )
      ),
    },
    {
      key: 'requires_allocation',
      label: 'Requires Allocation',
      render: (t) => (t.requires_allocation ? 'Yes (Fixed Grant)' : 'No (Unlimited)'),
    },
    {
      key: 'requires_approval',
      label: 'Requires Approval',
      render: (t) => (t.requires_approval ? 'Yes (Manager Review)' : 'No (Auto-approved)'),
    },
  ], []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Time Off & Leaves</h1>
          <p className="meta">
            Manage leave types, balances, allocations and employee time off approval workflow
          </p>
        </div>
        <div className="row">
          {activeTab === 'requests' && !isAdmin && (
            <button className="btn btn-primary" onClick={openNewRequestModal}>
              + Request Time Off
            </button>
          )}
          {activeTab === 'allocations' && canWriteAllocations && (
            <button className="btn btn-primary" onClick={openNewAllocModal}>
              + Allocate Leave Days
            </button>
          )}
          {activeTab === 'types' && canWriteTypes && (
            <button className="btn btn-primary" onClick={openCreateTypeModal}>
              + New Leave Type
            </button>
          )}
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 20, gap: 8 }}>
        <button
          className={`btn ${activeTab === 'requests' ? 'btn-primary' : ''}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 0 }}
          onClick={() => setTab('requests')}
        >
          Time Off Requests {pendingRequestsCount > 0 && `(${pendingRequestsCount} Pending)`}
        </button>
        <button
          className={`btn ${activeTab === 'allocations' ? 'btn-primary' : ''}`}
          style={{ borderRadius: '8px 8px 0 0', borderBottom: 0 }}
          onClick={() => setTab('allocations')}
        >
          Allocations
        </button>
        {!isEmployee && canWriteTypes && (
          <button
            className={`btn ${activeTab === 'types' ? 'btn-primary' : ''}`}
            style={{ borderRadius: '8px 8px 0 0', borderBottom: 0 }}
            onClick={() => setTab('types')}
          >
            Leave Types Config
          </button>
        )}
      </div>

      {/* Live Leave Balance Widget for Selected Employee */}
      <Card className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h3 style={{ margin: 0 }}>Active Leave Balances</h3>
            <span className="meta">Approved allocations minus approved requests update live immediately</span>
          </div>
          {!isEmployee && (
            <div style={{ minWidth: 220 }}>
              <select
                className="select"
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
              >
                {(employees.data || []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
        <LeaveBalanceWidget key={`${selectedEmployeeId}-${balanceKey}`} employeeId={selectedEmployeeId} />
      </Card>

      {/* TAB 1: REQUESTS */}
      {activeTab === 'requests' && (
        <>
          <div className="row" style={{ marginBottom: 16, justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button
                className={`btn btn-sm ${requestFilterState === 'all' ? 'btn-primary' : ''}`}
                onClick={() => setRequestFilterState('all')}
              >
                All Requests
              </button>
              {!isEmployee && (
                <button
                  className={`btn btn-sm ${requestFilterState === 'to_approve' ? 'btn-primary' : ''}`}
                  onClick={() => setRequestFilterState('to_approve')}
                >
                  Needs My Approval ({pendingRequestsCount})
                </button>
              )}
              <button
                className={`btn btn-sm ${requestFilterState === 'approved' ? 'btn-primary' : ''}`}
                onClick={() => setRequestFilterState('approved')}
              >
                Approved
              </button>
              <button
                className={`btn btn-sm ${requestFilterState === 'refused' ? 'btn-primary' : ''}`}
                onClick={() => setRequestFilterState('refused')}
              >
                Refused
              </button>
              <button
                className={`btn btn-sm ${requestFilterState === 'cancelled' ? 'btn-primary' : ''}`}
                onClick={() => setRequestFilterState('cancelled')}
              >
                Cancelled
              </button>
            </div>

            <SearchInput
              placeholder="Search employee or leave type..."
              value={requestSearch}
              onChange={setRequestSearch}
              style={{ width: 280 }}
            />
          </div>


          <States loading={reqLoading} error={reqError} empty={!requests?.length} onRetry={reloadRequests}>
            <Card pad={false}>
              <Table columns={requestColumns} rows={requests || []} />
            </Card>
          </States>
        </>
      )}

      {/* TAB 2: ALLOCATIONS */}
      {activeTab === 'allocations' && (
        <States loading={allocLoading} error={allocError} empty={!allocations?.length} onRetry={reloadAllocations}>
          <Card pad={false}>
            <Table columns={allocationColumns} rows={allocations || []} />
          </Card>
        </States>
      )}

      {/* TAB 3: TYPES */}
      {activeTab === 'types' && (
        <States loading={typesData.loading} error={typesData.error} empty={!typesData.data?.length} onRetry={typesData.reload}>
          <Card pad={false}>
            <Table columns={typeColumns} rows={typesData.data || []} onRowClick={openEditTypeModal} />
          </Card>
        </States>
      )}

      {/* Request Modal */}
      {newRequestModalOpen && (
        <Modal title="Request Time Off" onClose={() => setNewRequestModalOpen(false)} width={600}>
          <form onSubmit={handleSaveRequest} style={{ display: 'grid', gap: 16 }}>
            {reqFormError && <Alert level="error">{reqFormError}</Alert>}

            <Field label="Employee *">
              <select
                className="select"
                value={reqForm.employee_id}
                onChange={(e) => handleReqFieldChange('employee_id', e.target.value)}
                disabled={isEmployee}
                required
              >
                <option value="">Select Employee...</option>
                {(employees.data || []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Leave Type *">
              <select
                className="select"
                value={reqForm.type_id}
                onChange={(e) => handleReqFieldChange('type_id', e.target.value)}
                required
              >
                <option value="">Select Type...</option>
                {(typesData.data || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.unit}) {t.is_paid ? '— Paid' : '— Unpaid (LOP)'}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-2">
              <Field label="Start Date *">
                <input
                  className="input"
                  type="date"
                  value={reqForm.date_from}
                  onChange={(e) => handleReqFieldChange('date_from', e.target.value)}
                  required
                />
              </Field>

              <Field label="End Date *">
                <input
                  className="input"
                  type="date"
                  value={reqForm.date_to}
                  onChange={(e) => handleReqFieldChange('date_to', e.target.value)}
                  required
                />
              </Field>
            </div>

            <Field label="Duration (Calculated working days)">
              <input
                className="input"
                type="number"
                min="0.5"
                step="0.5"
                value={reqForm.duration}
                onChange={(e) => handleReqFieldChange('duration', e.target.value)}
                required
              />
            </Field>

            <Field label="Reason / Notes">
              <input
                className="input"
                type="text"
                placeholder="e.g. Vacation / Personal leave"
                value={reqForm.reason}
                onChange={(e) => handleReqFieldChange('reason', e.target.value)}
              />
            </Field>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setNewRequestModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={reqSaving}>
                {reqSaving ? 'Submitting...' : 'Submit Request'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Allocation Modal */}
      {newAllocModalOpen && (
        <Modal title="Allocate Leave Days" onClose={() => setNewAllocModalOpen(false)} width={540}>
          <form onSubmit={handleSaveAllocation} style={{ display: 'grid', gap: 16 }}>
            {allocFormError && <Alert level="error">{allocFormError}</Alert>}

            <Field label="Employee *">
              <select
                className="select"
                value={allocForm.employee_id}
                onChange={(e) => setAllocForm({ ...allocForm, employee_id: e.target.value })}
                required
              >
                <option value="">Select Employee...</option>
                {(employees.data || []).map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </Field>

            <div className="grid grid-2">
              <Field label="Leave Type *">
                <select
                  className="select"
                  value={allocForm.type_id}
                  onChange={(e) => setAllocForm({ ...allocForm, type_id: e.target.value })}
                  required
                >
                  <option value="">Select Type...</option>
                  {(typesData.data || []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.unit})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Amount to Allocate (e.g. 18 days) *">
                <input
                  className="input"
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={allocForm.amount}
                  onChange={(e) => setAllocForm({ ...allocForm, amount: e.target.value })}
                  required
                />
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Valid From Date *">
                <input
                  className="input"
                  type="date"
                  value={allocForm.valid_from}
                  onChange={(e) => setAllocForm({ ...allocForm, valid_from: e.target.value })}
                  required
                />
              </Field>

              <Field label="Valid To Date (Optional)">
                <input
                  className="input"
                  type="date"
                  value={allocForm.valid_to}
                  onChange={(e) => setAllocForm({ ...allocForm, valid_to: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Initial State">
              <select
                className="select"
                value={allocForm.state}
                onChange={(e) => setAllocForm({ ...allocForm, state: e.target.value })}
              >
                <option value="approved">Approved (Active Balance)</option>
                <option value="draft">Draft (Pending Approval)</option>
              </select>
            </Field>

            <Field label="Allocation Note">
              <input
                className="input"
                type="text"
                placeholder="e.g. Annual Vacation entitlement"
                value={allocForm.note}
                onChange={(e) => setAllocForm({ ...allocForm, note: e.target.value })}
              />
            </Field>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setNewAllocModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={allocSaving}>
                {allocSaving ? 'Allocating...' : 'Allocate Leave'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Leave Type Modal */}
      {typeModalOpen && (
        <Modal
          title={editingType ? `Edit Leave Type: ${editingType.name}` : 'New Leave Type'}
          onClose={() => setTypeModalOpen(false)}
          width={540}
        >
          <form onSubmit={handleSaveType} style={{ display: 'grid', gap: 16 }}>
            {typeFormError && <Alert level="error">{typeFormError}</Alert>}

            <div className="grid grid-2">
              <Field label="Type Name *">
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Paid Time Off"
                  value={typeForm.name}
                  onChange={(e) => setTypeForm({ ...typeForm, name: e.target.value })}
                  required
                />
              </Field>

              <Field label="Code *">
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. PTO"
                  value={typeForm.code}
                  onChange={(e) => setTypeForm({ ...typeForm, code: e.target.value })}
                  required
                />
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Unit">
                <select
                  className="select"
                  value={typeForm.unit}
                  onChange={(e) => setTypeForm({ ...typeForm, unit: e.target.value })}
                >
                  <option value="day">Day</option>
                  <option value="hour">Hour</option>
                </select>
              </Field>

              <Field label="Color Theme">
                <input
                  className="input"
                  type="color"
                  style={{ height: 38, padding: 2 }}
                  value={typeForm.color}
                  onChange={(e) => setTypeForm({ ...typeForm, color: e.target.value })}
                />
              </Field>
            </div>

            <Field label="Paid or Unpaid">
              <select
                className="select"
                value={typeForm.is_paid ? 'true' : 'false'}
                onChange={(e) => setTypeForm({ ...typeForm, is_paid: e.target.value === 'true' })}
              >
                <option value="true">Paid Leave (Standard)</option>
                <option value="false">Unpaid Leave (Triggers LOP deduction in Payroll)</option>
              </select>
            </Field>

            <div className="grid grid-2">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={typeForm.requires_allocation}
                  onChange={(e) => setTypeForm({ ...typeForm, requires_allocation: e.target.checked })}
                />
                <span>Requires Allocation Grant</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={typeForm.requires_approval}
                  onChange={(e) => setTypeForm({ ...typeForm, requires_approval: e.target.checked })}
                />
                <span>Requires Manager Approval</span>
              </label>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setTypeModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn-primary" disabled={typeSaving}>
                {typeSaving ? 'Saving...' : editingType ? 'Update Type' : 'Create Type'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
