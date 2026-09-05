import { useState, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api, money } from '../../api.js';
import { useApi, States, Card, Table, Badge, Modal, Field, Alert } from '../../components/ui.jsx';

const TODAY = new Date().toISOString().slice(0, 10);

function isActiveToday(contract) {
  if (contract.state !== 'running') return false;
  if (contract.start_date > TODAY) return false;
  if (contract.end_date && contract.end_date < TODAY) return false;
  return true;
}

export default function ContractsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const employeeIdFilter = searchParams.get('employee_id') || '';
  const stateFilter = searchParams.get('state') || '';
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editingContract, setEditingContract] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [overlapWarning, setOverlapWarning] = useState(null);

  // Reference data
  const employees = useApi(() => api.get('/employees'), []);
  const departments = useApi(() => api.get('/departments'), []);
  const positions = useApi(() => api.get('/positions'), []);
  const structures = useApi(() => api.get('/structures'), []);
  const schedules = useApi(() => api.get('/schedules'), []);

  // Fetch contracts
  const { data: contracts, loading, error, reload } = useApi(
    () => {
      const q = new URLSearchParams();
      if (employeeIdFilter) q.set('employee_id', employeeIdFilter);
      if (stateFilter) q.set('state', stateFilter);
      if (search) q.set('search', search);
      const qs = q.toString();
      return api.get(`/contracts${qs ? '?' + qs : ''}`);
    },
    [employeeIdFilter, stateFilter, search]
  );

  // Form state
  const [form, setForm] = useState({
    employee_id: '',
    name: '',
    start_date: TODAY,
    end_date: '',
    department_id: '',
    job_position_id: '',
    schedule_id: '',
    wage: '',
    structure_id: '',
    state: 'draft',
  });

  const openCreateModal = () => {
    setEditingContract(null);
    setForm({
      employee_id: employeeIdFilter || '',
      name: '',
      start_date: TODAY,
      end_date: '',
      department_id: '',
      job_position_id: '',
      schedule_id: '',
      wage: '',
      structure_id: '',
      state: 'draft',
    });
    setFormError(null);
    setOverlapWarning(null);
    setModalOpen(true);
  };

  const openEditModal = (contract) => {
    setEditingContract(contract);
    setForm({
      employee_id: String(contract.employee_id || ''),
      name: contract.name || '',
      start_date: contract.start_date || TODAY,
      end_date: contract.end_date || '',
      department_id: contract.department_id ? String(contract.department_id) : '',
      job_position_id: contract.job_position_id ? String(contract.job_position_id) : '',
      schedule_id: contract.schedule_id ? String(contract.schedule_id) : '',
      wage: contract.wage !== undefined ? String(contract.wage) : '',
      structure_id: contract.structure_id ? String(contract.structure_id) : '',
      state: contract.state || 'draft',
    });
    setFormError(null);
    setOverlapWarning(null);
    setModalOpen(true);
  };

  // Pre-save check for concurrent running contract
  const checkOverlap = async (formData) => {
    if (formData.state !== 'running' || !formData.employee_id || !formData.start_date) {
      setOverlapWarning(null);
      return null;
    }
    try {
      const res = await api.post('/contracts/check-overlap', {
        employee_id: Number(formData.employee_id),
        start_date: formData.start_date,
        end_date: formData.end_date || null,
        exclude_id: editingContract ? editingContract.id : null,
      });
      const overlapping = res.overlapping || [];
      if (overlapping.length > 0) {
        const conflict = overlapping[0];
        const span = `${conflict.start_date} to ${conflict.end_date || 'indefinite'}`;
        const msg = `Concurrent-Contract Conflict: Overlaps with running contract "${conflict.name}" (${span}). A second running contract is not allowed.`;
        setOverlapWarning(msg);
        return msg;
      } else {
        setOverlapWarning(null);
        return null;
      }
    } catch {
      return null;
    }
  };

  const handleFieldChange = (field, val) => {
    const updated = { ...form, [field]: val };
    setForm(updated);

    // If changing employee, auto-fill department/position if available
    if (field === 'employee_id' && val) {
      const emp = (employees.data || []).find((e) => String(e.id) === String(val));
      if (emp) {
        updated.department_id = emp.department_id ? String(emp.department_id) : updated.department_id;
        updated.job_position_id = emp.job_position_id ? String(emp.job_position_id) : updated.job_position_id;
        updated.schedule_id = emp.schedule_id ? String(emp.schedule_id) : updated.schedule_id;
        if (!updated.name) {
          updated.name = `${emp.name} - Employment Contract`;
        }
      }
    }

    if (['state', 'employee_id', 'start_date', 'end_date'].includes(field)) {
      checkOverlap(updated);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);

    // Validations
    if (!form.employee_id) {
      setFormError('Please select an employee.');
      return;
    }
    if (!form.name.trim()) {
      setFormError('Contract name is required.');
      return;
    }
    if (!form.start_date) {
      setFormError('Start date is required.');
      return;
    }
    if (form.end_date && form.end_date < form.start_date) {
      setFormError('End date must be on or after start date.');
      return;
    }
    const wageNum = Number(form.wage);
    if (isNaN(wageNum) || wageNum <= 0) {
      setFormError('Wage must be a valid number greater than 0.');
      return;
    }
    if (form.state === 'running' && !form.structure_id) {
      setFormError('Salary structure is required when contract state is Running.');
      return;
    }

    // Check overlap
    const conflictMsg = await checkOverlap(form);
    if (conflictMsg) {
      setFormError(conflictMsg);
      return;
    }

    setSaving(true);
    const payload = {
      employee_id: Number(form.employee_id),
      name: form.name.trim(),
      start_date: form.start_date,
      end_date: form.end_date || null,
      department_id: form.department_id ? Number(form.department_id) : null,
      job_position_id: form.job_position_id ? Number(form.job_position_id) : null,
      schedule_id: form.schedule_id ? Number(form.schedule_id) : null,
      wage: wageNum,
      structure_id: form.structure_id ? Number(form.structure_id) : null,
      state: form.state,
    };

    try {
      if (editingContract) {
        await api.patch(`/contracts/${editingContract.id}`, payload);
      } else {
        await api.post('/contracts', payload);
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err.message || 'Failed to save contract');
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo(() => [
    {
      key: 'name',
      label: 'Contract',
      render: (r) => {
        const active = isActiveToday(r);
        return (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600 }}>{r.name}</span>
              {active && (
                <span className="badge badge-success" style={{ fontSize: 11, padding: '1px 6px' }}>
                  ● Active Today
                </span>
              )}
            </div>
            <div className="meta" style={{ marginTop: 2 }}>
              {r.department_name || 'No department'} {r.job_position_name ? `· ${r.job_position_name}` : ''}
            </div>
          </div>
        );
      },
    },
    {
      key: 'employee_name',
      label: 'Employee',
      render: (r) => (
        <span
          className="clickable"
          style={{ textDecoration: 'underline', color: 'var(--accent)' }}
          onClick={(e) => {
            e.stopPropagation();
            setSearchParams({ employee_id: String(r.employee_id) });
          }}
        >
          {r.employee_name}
        </span>
      ),
    },
    {
      key: 'dates',
      label: 'Period',
      render: (r) => (
        <span>
          {r.start_date} <span className="muted">→</span> {r.end_date || 'Open-ended'}
        </span>
      ),
    },
    {
      key: 'wage',
      label: 'Wage',
      align: 'right',
      render: (r) => <strong>{money(r.wage)}</strong>,
    },
    {
      key: 'structure_name',
      label: 'Structure',
      render: (r) => r.structure_name || <span className="muted">—</span>,
    },
    {
      key: 'schedule_name',
      label: 'Schedule',
      render: (r) => r.schedule_name || <span className="muted">Standard</span>,
    },
    {
      key: 'state',
      label: 'State',
      render: (r) => <Badge value={r.state} />,
    },
  ], [setSearchParams]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Employee Contracts</h1>
          <p className="meta">Manage employment agreements, active wages, and salary structures</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/schedules')}>
            Working Schedules ➔
          </button>
          <button className="btn btn-primary" onClick={openCreateModal}>
            + New Contract
          </button>
        </div>
      </div>

      <Card className="card" title="Filter Contracts">
        <div className="grid grid-3">
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
              <option value="">All Employees</option>
              {(employees.data || []).map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Contract State</label>
            <select
              className="select"
              value={stateFilter}
              onChange={(e) => {
                const next = new URLSearchParams(searchParams);
                if (e.target.value) next.set('state', e.target.value);
                else next.delete('state');
                setSearchParams(next);
              }}
            >
              <option value="">All States</option>
              <option value="running">Running</option>
              <option value="draft">Draft</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>

          <div className="field">
            <label>Search</label>
            <input
              className="input"
              type="text"
              placeholder="Search by contract or employee name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        {(employeeIdFilter || stateFilter || search) && (
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-sm"
              onClick={() => {
                setSearchParams({});
                setSearch('');
              }}
            >
              Reset Filters
            </button>
          </div>
        )}
      </Card>

      <div style={{ height: 20 }} />

      <States loading={loading} error={error} empty={!contracts?.length} onRetry={reload}>
        <Card pad={false}>
          <Table columns={columns} rows={contracts || []} onRowClick={openEditModal} />
        </Card>
      </States>

      {/* Contract Create / Edit Modal */}
      {modalOpen && (
        <Modal
          title={editingContract ? `Edit Contract: ${editingContract.name}` : 'New Contract'}
          onClose={() => setModalOpen(false)}
          width={640}
        >
          <form onSubmit={handleSave} style={{ display: 'grid', gap: 16 }}>
            {overlapWarning && (
              <Alert level="warning">
                <strong>Concurrent-Contract Guard</strong>: {overlapWarning}
              </Alert>
            )}

            {formError && <Alert level="error">{formError}</Alert>}

            <div className="grid grid-2">
              <Field label="Employee *">
                <select
                  className="select"
                  value={form.employee_id}
                  onChange={(e) => handleFieldChange('employee_id', e.target.value)}
                  disabled={Boolean(editingContract)}
                  required
                >
                  <option value="">Select Employee...</option>
                  {(employees.data || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.name} ({emp.employee_type || 'full_time'})
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Contract State *">
                <select
                  className="select"
                  value={form.state}
                  onChange={(e) => handleFieldChange('state', e.target.value)}
                >
                  <option value="draft">Draft</option>
                  <option value="running">Running (Active)</option>
                  <option value="expired">Expired</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </Field>
            </div>

            <Field label="Contract Reference Name *">
              <input
                className="input"
                type="text"
                placeholder="e.g. Full-time Employment Contract 2026"
                value={form.name}
                onChange={(e) => handleFieldChange('name', e.target.value)}
                required
              />
            </Field>

            <div className="grid grid-2">
              <Field label="Start Date *">
                <input
                  className="input"
                  type="date"
                  value={form.start_date}
                  onChange={(e) => handleFieldChange('start_date', e.target.value)}
                  required
                />
              </Field>

              <Field label="End Date (Leave blank for indefinite)">
                <input
                  className="input"
                  type="date"
                  value={form.end_date}
                  onChange={(e) => handleFieldChange('end_date', e.target.value)}
                />
              </Field>
            </div>

            <div className="grid grid-2">
              <Field label="Monthly Wage (₹) *">
                <input
                  className="input"
                  type="number"
                  min="1"
                  step="100"
                  placeholder="e.g. 50000"
                  value={form.wage}
                  onChange={(e) => handleFieldChange('wage', e.target.value)}
                  required
                />
              </Field>

              <Field label="Salary Structure *">
                <select
                  className="select"
                  value={form.structure_id}
                  onChange={(e) => handleFieldChange('structure_id', e.target.value)}
                  required={form.state === 'running'}
                >
                  <option value="">Select Structure...</option>
                  {(structures.data || []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid grid-3">
              <Field label="Department">
                <select
                  className="select"
                  value={form.department_id}
                  onChange={(e) => handleFieldChange('department_id', e.target.value)}
                >
                  <option value="">None</option>
                  {(departments.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Job Position">
                <select
                  className="select"
                  value={form.job_position_id}
                  onChange={(e) => handleFieldChange('job_position_id', e.target.value)}
                >
                  <option value="">None</option>
                  {(positions.data || []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Working Schedule">
                <select
                  className="select"
                  value={form.schedule_id}
                  onChange={(e) => handleFieldChange('schedule_id', e.target.value)}
                >
                  <option value="">None (Default)</option>
                  {(schedules.data || []).map((sch) => (
                    <option key={sch.id} value={sch.id}>
                      {sch.name} ({sch.hours_per_week || 40}h)
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={saving || Boolean(overlapWarning)}
              >
                {saving ? 'Saving...' : editingContract ? 'Update Contract' : 'Create Contract'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
