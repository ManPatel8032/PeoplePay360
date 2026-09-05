import { useState, useEffect } from 'react';
import { api } from '../../api.js';
import { Modal, Field, Alert } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

/** Field label with an inline "+ New" toggle, so lookups can be created in place. */
function LabelWithAdd({ text, adding, onToggle }) {
  return (
    <span className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
      <span>{text}</span>
      <button
        type="button"
        onClick={onToggle}
        style={{
          background: 'none', border: 0, padding: 0, cursor: 'pointer',
          font: 'inherit', fontSize: 11, fontWeight: 600, color: 'var(--accent)',
        }}
      >
        {adding ? 'Cancel' : '+ New'}
      </button>
    </span>
  );
}

export default function EmployeeFormModal({ employee, onClose, onSaved }) {
  const { can } = useAuth();
  const canDeleteEmployees = can('employees', 'delete') !== 'none';
  const isEditing = Boolean(employee?.id);

  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);

  const [form, setForm] = useState({
    name: employee?.name || '',
    work_email: employee?.work_email || '',
    phone: employee?.phone || '',
    department_id: employee?.department_id ? String(employee.department_id) : '',
    job_position_id: employee?.job_position_id ? String(employee.job_position_id) : '',
    manager_id: employee?.manager_id ? String(employee.manager_id) : '',
    schedule_id: employee?.schedule_id ? String(employee.schedule_id) : '',
    employee_type: employee?.employee_type || 'full_time',
    status: employee?.status || 'active',
    bank_account: employee?.bank_account || '',
    join_date: employee?.join_date ? employee.join_date.slice(0, 10) : new Date().toISOString().slice(0, 10),
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  // Inline creation of the two lookup tables. Without this the dropdowns are
  // frozen to whatever the seed inserted and HR cannot onboard into a new
  // department or job title.
  const [addingDept, setAddingDept] = useState(false);
  const [addingPos, setAddingPos] = useState(false);
  const [newDept, setNewDept] = useState('');
  const [newPos, setNewPos] = useState('');
  const [lookupSaving, setLookupSaving] = useState(false);

  const rows = (r) => (Array.isArray(r) ? r : r?.data || []);

  async function createDepartment() {
    const name = newDept.trim();
    if (!name) return;
    setLookupSaving(true);
    setError(null);
    try {
      const created = await api.post('/departments', { name });
      setDepartments(rows(await api.get('/departments')));
      setForm((prev) => ({ ...prev, department_id: String(created.id), job_position_id: '' }));
      setNewDept('');
      setAddingDept(false);
    } catch (err) {
      setError(err.message || 'Could not create department');
    } finally {
      setLookupSaving(false);
    }
  }

  async function createPosition() {
    const name = newPos.trim();
    if (!name) return;
    setLookupSaving(true);
    setError(null);
    try {
      const created = await api.post('/positions', {
        name,
        department_id: form.department_id ? Number(form.department_id) : null,
      });
      setPositions(rows(await api.get('/positions')));
      setForm((prev) => ({ ...prev, job_position_id: String(created.id) }));
      setNewPos('');
      setAddingPos(false);
    } catch (err) {
      setError(err.message || 'Could not create job position');
    } finally {
      setLookupSaving(false);
    }
  }

  /** Enter inside an inline lookup field must not submit the employee form. */
  const submitOnEnter = (fn) => (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      fn();
    }
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  function valid_phone(phone) {
    if (!phone) return false;
    const str = String(phone).trim();
    return /^[0-9]{10}$/.test(str) || /^\+91[\s-]?[0-9]{10}$/.test(str);
  }


  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/departments').catch(() => []),
      api.get('/positions').catch(() => []),
      api.get('/schedules').catch(() => []),
      api.get('/employees').catch(() => []),
    ]).then(([deps, pos, scheds, emps]) => {
      if (!alive) return;
      setDepartments(Array.isArray(deps) ? deps : deps?.data || []);
      setPositions(Array.isArray(pos) ? pos : pos?.data || []);
      setSchedules(Array.isArray(scheds) ? scheds : scheds?.data || []);
      setAllEmployees(Array.isArray(emps) ? emps : emps?.data || []);
    });
    return () => { alive = false; };
  }, []);

  const filteredPositions = positions.filter((p) => {
    if (!form.department_id) return true;
    return String(p.department_id) === String(form.department_id);
  });

  const availableManagers = allEmployees.filter((e) => {
    if (isEditing && e.id === employee.id) return false;
    return true;
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const next = { ...prev, [name]: value };
      if (name === 'department_id' && prev.department_id !== value) {
        next.job_position_id = '';
      }
      return next;
    });
    setFieldErrors((prev) => ({
      ...prev,
      [name]: null,
      ...(name === 'department_id' ? { job_position_id: null } : {}),
    }));
    setError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setFieldErrors((prev) => ({ ...prev, name: 'Employee name is required' }));
      return;
    }
    if (!form.work_email.trim()) {
      setFieldErrors((prev) => ({ ...prev, work_email: 'Work email is required' }));
      return;
    }
    if (!EMAIL_RE.test(form.work_email.trim())) {
      setFieldErrors((prev) => ({ ...prev, work_email: 'Please enter a valid email address' }));
      return;
    }
    if (!form.phone || !form.phone.trim()) {
      setFieldErrors((prev) => ({ ...prev, phone: 'Phone number is required' }));
      return;
    }
    if (!valid_phone(form.phone)) {
      setFieldErrors((prev) => ({ ...prev, phone: 'Please enter a valid 10-digit mobile number' }));
      return;
    }
    if (!form.department_id) {
      setFieldErrors((prev) => ({ ...prev, department_id: 'Department is required' }));
      return;
    }
    if (!form.job_position_id) {
      setFieldErrors((prev) => ({ ...prev, job_position_id: 'Job position is required' }));
      return;
    }
    if (!form.schedule_id) {
      setFieldErrors((prev) => ({ ...prev, schedule_id: 'Schedule is required' }));
      return;
    }
    if (!form.employee_type) {
      setFieldErrors((prev) => ({ ...prev, employee_type: 'Employee type is required' }));
      return;
    }
    if (!form.join_date) {
      setFieldErrors((prev) => ({ ...prev, join_date: 'Join date is required' }));
      return;
    }
    if (!form.status) {
      setFieldErrors((prev) => ({ ...prev, status: 'Status is required' }));
      return;
    }

    setSaving(true);
    setError(null);
    setFieldErrors({});


    const payload = {
      name: form.name.trim(),
      work_email: form.work_email.trim(),
      phone: form.phone.trim() || null,
      department_id: form.department_id ? Number(form.department_id) : null,
      job_position_id: form.job_position_id ? Number(form.job_position_id) : null,
      manager_id: form.manager_id ? Number(form.manager_id) : null,
      schedule_id: form.schedule_id ? Number(form.schedule_id) : null,
      employee_type: form.employee_type,
      status: form.status,
      bank_account: form.bank_account.trim() || null,
      join_date: form.join_date || new Date().toISOString().slice(0, 10),
    };

    try {
      if (isEditing) {
        await api.patch(`/employees/${employee.id}`, payload);
      } else {
        await api.post('/employees', payload);
      }
      onSaved?.();
    } catch (err) {
      setError(err.message || 'Failed to save employee');
      if (err.fields) {
        setFieldErrors(err.fields);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title={isEditing ? `Edit ${employee.name}` : 'New Employee'}
      onClose={onClose}
      width={640}
    >
      {error && (
        <Alert level="error" style={{ marginBottom: 16 }}>
          {error}
        </Alert>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-2">
          <Field label="Full Name *" error={fieldErrors.name}>
            <input
              type="text"
              name="name"
              className="input"
              value={form.name}
              onChange={handleChange}
              placeholder="e.g. Aarav Mehta"
              required
            />
          </Field>

          <Field label="Work Email *" error={fieldErrors.work_email}>
            <input
              type="email"
              name="work_email"
              className="input"
              value={form.work_email}
              onChange={handleChange}
              placeholder="e.g. aarav@peoplepay360.com"
              required
            />
          </Field>

          <Field label="Phone Number *" error={fieldErrors.phone}>
            <input
              type="tel"
              name="phone"
              className="input"
              value={form.phone}
              onChange={handleChange}
              onBlur={() => {
                if (form.phone?.trim() && !valid_phone(form.phone)) {
                  setFieldErrors((prev) => ({ ...prev, phone: 'Phone number must be at least 10 digits' }));
                }
              }}
              placeholder="10 digit number (e.g. 9876543210)"
              minLength={10}
              maxLength={15}
              pattern="^(\+91[\s-]?)?[0-9]{10}$"
              title="Must be a 10-digit number or +91 followed by 10 digits"
              required
            />
          </Field>


          <Field
            label={
              <LabelWithAdd
                text="Department *"
                adding={addingDept}
                onToggle={() => { setAddingDept((v) => !v); setNewDept(''); }}
              />
            }
            error={fieldErrors.department_id}
          >
            {addingDept ? (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  className="input"
                  value={newDept}
                  autoFocus
                  placeholder="e.g. Customer Success"
                  onChange={(e) => setNewDept(e.target.value)}
                  onKeyDown={submitOnEnter(createDepartment)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={createDepartment}
                  disabled={lookupSaving || !newDept.trim()}
                >
                  {lookupSaving ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <select
                name="department_id"
                className="select"
                value={form.department_id}
                onChange={handleChange}
              >
                <option value="">— Select Department —</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field
            label={
              <LabelWithAdd
                text="Job Position *"
                adding={addingPos}
                onToggle={() => { setAddingPos((v) => !v); setNewPos(''); }}
              />
            }
            error={fieldErrors.job_position_id}
          >
            {addingPos ? (
              <div className="row" style={{ flexWrap: 'nowrap' }}>
                <input
                  type="text"
                  className="input"
                  value={newPos}
                  autoFocus
                  placeholder="e.g. Support Engineer"
                  onChange={(e) => setNewPos(e.target.value)}
                  onKeyDown={submitOnEnter(createPosition)}
                />
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  onClick={createPosition}
                  disabled={lookupSaving || !newPos.trim()}
                >
                  {lookupSaving ? '…' : 'Add'}
                </button>
              </div>
            ) : (
              <select
                name="job_position_id"
                className="select"
                value={form.job_position_id}
                onChange={handleChange}
              >
                <option value="">— Select Position —</option>
                {filteredPositions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </Field>

          <Field label="Manager (Optional for Top Level)" error={fieldErrors.manager_id}>
            <select
              name="manager_id"
              className="select"
              value={form.manager_id}
              onChange={handleChange}
            >
              <option value="">— None (Top Level) —</option>
              {availableManagers.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.department_name || 'No Dept'})</option>
              ))}
            </select>
          </Field>

          <Field label="Working Schedule *" error={fieldErrors.schedule_id}>
            <select
              name="schedule_id"
              className="select"
              value={form.schedule_id}
              onChange={handleChange}
            >
              <option value="">— Select Schedule —</option>
              {schedules.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Employee Type *" error={fieldErrors.employee_type}>
            <select
              name="employee_type"
              className="select"
              value={form.employee_type}
              onChange={handleChange}
            >
              <option value="full_time">Full Time</option>
              <option value="part_time">Part Time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </Field>

          <Field label="Status *" error={fieldErrors.status}>
            <select
              name="status"
              className="select"
              value={form.status}
              onChange={handleChange}
            >
              <option value="active">Active</option>
              <option value="on_leave">On Leave</option>
              <option value="inactive">Inactive</option>
            </select>
          </Field>

          <Field label="Join Date *" error={fieldErrors.join_date}>
            <input
              type="date"
              name="join_date"
              className="input"
              value={form.join_date}
              onChange={handleChange}
              required
            />
          </Field>


          <div style={{ gridColumn: 'span 2' }}>
            <Field label="Bank Account" error={fieldErrors.bank_account}>
              <input
                type="text"
                name="bank_account"
                className="input"
                value={form.bank_account}
                onChange={handleChange}
                placeholder="e.g. HDFC0001-8827341"
              />
              <span className="meta" style={{ marginTop: 2 }}>
                Used for payroll disbursement. Missing account generates a payroll warning.
              </span>
            </Field>
          </div>
        </div>

        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 20 }}>
          <div>
            {isEditing && canDeleteEmployees && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={saving}
                onClick={async () => {
                  if (!confirm(`Permanently delete employee "${form.name}"? This action cannot be undone.`)) return;
                  setSaving(true);
                  try {
                    await api.del(`/employees/${employee.id}`);
                    onClose();
                    onSaved?.();
                  } catch (err) {
                    setError(err.message || 'Failed to delete employee');
                    setSaving(false);
                  }
                }}
              >
                Delete Employee
              </button>
            )}
          </div>
          <div className="row">
            <button type="button" className="btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : isEditing ? 'Update Employee' : 'Create Employee'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}