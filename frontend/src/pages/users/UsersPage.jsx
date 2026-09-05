/**
 * User Administration (Admin only).
 * Create logins, assign roles, link them to employee records, deactivate
 * accounts, reset passwords and clear lockouts.
 */
import { useState } from 'react';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, Card, Table, Badge, Field, Modal, Alert } from '../../components/ui.jsx';

const ROLES = [
  { value: 'employee', label: 'Employee' },
  { value: 'hr_manager', label: 'HR Manager' },
  { value: 'payroll_user', label: 'Payroll User' },
  { value: 'payroll_manager', label: 'Payroll Manager' },
  { value: 'admin', label: 'Admin' },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r;

const isLocked = (u) => u.locked_until && new Date(u.locked_until) > new Date();

function fmtDate(v) {
  if (!v) return 'Never';
  const d = new Date(v);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useApi(() => api.get('/users'), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [banner, setBanner] = useState(null);

  const say = (msg) => { setBanner(msg); setTimeout(() => setBanner(null), 4000); };

  async function toggleActive(u) {
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active });
      say(`${u.name} ${u.is_active ? 'deactivated' : 'reactivated'}.`);
      users.reload();
    } catch (err) { say(err.message); }
  }

  async function unlock(u) {
    try {
      await api.post(`/users/${u.id}/unlock`);
      say(`${u.name} unlocked.`);
      users.reload();
    } catch (err) { say(err.message); }
  }

  const columns = [
    {
      key: 'name', label: 'User',
      render: (u) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {u.name}{u.id === me?.id && <span className="meta"> (you)</span>}
          </div>
          <div className="meta">{u.email}</div>
        </div>
      ),
    },
    { key: 'role', label: 'Role', render: (u) => <Badge value={roleLabel(u.role)} tone="accent" /> },
    {
      key: 'employee_name', label: 'Employee record',
      render: (u) => u.employee_name
        ? <div>{u.employee_name}<div className="meta">{u.department_name || '—'}</div></div>
        : <span className="muted">Not linked</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (u) => {
        if (!u.is_active) return <Badge value="inactive" tone="danger" />;
        if (isLocked(u)) return <Badge value="locked" tone="warning" />;
        if (u.must_change_password) return <Badge value="must reset" tone="warning" />;
        return <Badge value="active" tone="success" />;
      },
    },
    { key: 'last_login_at', label: 'Last login', render: (u) => <span className="meta">{fmtDate(u.last_login_at)}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (u) => (
        <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
          <button className="btn btn-sm" onClick={() => setEditing(u)}>Edit</button>
          <button className="btn btn-sm" onClick={() => setResetting(u)}>Reset password</button>
          {isLocked(u) && <button className="btn btn-sm" onClick={() => unlock(u)}>Unlock</button>}
          <button
            className={`btn btn-sm ${u.is_active ? 'btn-danger' : ''}`}
            onClick={() => toggleActive(u)}
            disabled={u.id === me?.id}
            title={u.id === me?.id ? 'You cannot deactivate your own account' : ''}
          >
            {u.is_active ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      ),
    },
  ];

  const list = users.data || [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Administration</h1>
          <p className="meta">Logins, role assignment and account access. Admin only.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>+ New User</button>
      </div>

      {banner && <div style={{ marginBottom: 16 }}><Alert level="info">{banner}</Alert></div>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><div className="kpi"><div className="kpi-label">Accounts</div><div className="kpi-value">{list.length}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">Active</div><div className="kpi-value">{list.filter((u) => u.is_active).length}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">Admins</div><div className="kpi-value">{list.filter((u) => u.role === 'admin' && u.is_active).length}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">Locked out</div><div className="kpi-value">{list.filter(isLocked).length}</div></div></Card>
      </div>

      <States loading={users.loading} error={users.error} onRetry={users.reload} empty={!users.loading && list.length === 0}>
        <Table columns={columns} rows={list} empty="No user accounts yet" />
      </States>

      {creating && (
        <UserFormModal
          onClose={() => setCreating(false)}
          onSaved={(name) => { setCreating(false); say(`${name} created.`); users.reload(); }}
        />
      )}
      {editing && (
        <UserFormModal
          user={editing}
          isSelf={editing.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(name) => { setEditing(null); say(`${name} updated.`); users.reload(); }}
        />
      )}
      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => { const n = resetting.name; setResetting(null); say(`Password reset for ${n}. They must change it at next login.`); users.reload(); }}
        />
      )}
    </>
  );
}

function UserFormModal({ user, isSelf, onClose, onSaved }) {
  const editing = Boolean(user?.id);
  const linkable = useApi(() => api.get('/users/linkable/employees'), []);

  const [form, setForm] = useState({
    name: user?.name || '',
    email: user?.email || '',
    role: user?.role || 'employee',
    employee_id: user?.employee_id ? String(user.employee_id) : '',
    password: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFieldErrors((f) => ({ ...f, [k]: null }));
    setError(null);
  };

  /** When creating, pick an employee to prefill name + work email. */
  function pickEmployee(e) {
    const id = e.target.value;
    const emp = (linkable.data || []).find((x) => String(x.id) === id);
    setForm((f) => ({
      ...f,
      employee_id: id,
      name: !editing && emp ? emp.name : f.name,
      email: !editing && emp?.work_email ? emp.work_email : f.email,
    }));
  }

  async function submit(e) {
    e.preventDefault();
    const errs = {};
    if (!form.name.trim()) errs.name = 'Name is required';
    if (!editing && !/^\S+@\S+\.\S+$/.test(form.email.trim())) errs.email = 'Enter a valid email address';
    if (!editing && form.password.length < 10) errs.password = 'Password must be at least 10 characters';
    setFieldErrors(errs);
    if (Object.keys(errs).length) return;

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        const payload = {
          name: form.name.trim(),
          employee_id: form.employee_id ? Number(form.employee_id) : null,
        };
        if (!isSelf) payload.role = form.role;
        await api.patch(`/users/${user.id}`, payload);
      } else {
        await api.post('/users', {
          name: form.name.trim(),
          email: form.email.trim(),
          role: form.role,
          employee_id: form.employee_id ? Number(form.employee_id) : null,
          password: form.password,
        });
      }
      onSaved?.(form.name.trim());
    } catch (err) {
      setError(err.message);
      if (err.fields) setFieldErrors(err.fields);
    } finally {
      setSaving(false);
    }
  }

  // When editing, the currently linked employee is not in the "linkable" list.
  const options = [...(linkable.data || [])];
  if (editing && user.employee_id && !options.some((o) => o.id === user.employee_id)) {
    options.unshift({ id: user.employee_id, name: user.employee_name, department_name: user.department_name });
  }

  return (
    <Modal title={editing ? `Edit ${user.name}` : 'New User'} onClose={onClose} width={560}>
      {error && <div style={{ marginBottom: 16 }}><Alert level="error">{error}</Alert></div>}

      <form onSubmit={submit}>
        <div className="grid grid-2">
          <Field label="Employee record">
            <select className="select" value={form.employee_id} onChange={pickEmployee}>
              <option value="">— Not linked —</option>
              {options.map((e) => (
                <option key={e.id} value={e.id}>{e.name}{e.department_name ? ` · ${e.department_name}` : ''}</option>
              ))}
            </select>
            <span className="meta">Links this login to an HR record. Only employees without an account are listed.</span>
          </Field>

          <Field label="Role" error={fieldErrors.role}>
            <select className="select" value={form.role} onChange={set('role')} disabled={isSelf}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            {isSelf && <span className="meta">You cannot change your own role.</span>}
          </Field>

          <Field label="Full name *" error={fieldErrors.name}>
            <input className="input" value={form.name} onChange={set('name')} placeholder="e.g. Meera Joshi" />
          </Field>

          <Field label="Email *" error={fieldErrors.email}>
            <input
              className="input" type="email" value={form.email} onChange={set('email')}
              placeholder="e.g. meera@peoplepay360.com" disabled={editing}
            />
            {editing && <span className="meta">Email cannot be changed after creation.</span>}
          </Field>

          {!editing && (
            <div style={{ gridColumn: 'span 2' }}>
              <Field label="Temporary password *" error={fieldErrors.password}>
                <input
                  className="input" type="text" autoComplete="new-password"
                  value={form.password} onChange={set('password')}
                  placeholder="At least 10 characters"
                />
                <span className="meta">Share this with the user — they must change it at first login.</span>
              </Field>
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update User' : 'Create User'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (password.length < 10) return setError('Password must be at least 10 characters');
    setSaving(true);
    setError(null);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword: password });
      onSaved?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Reset password — ${user.name}`} onClose={onClose} width={460}>
      {error && <div style={{ marginBottom: 16 }}><Alert level="error">{error}</Alert></div>}
      <form onSubmit={submit}>
        <Field label="New temporary password">
          <input
            className="input" type="text" autoFocus autoComplete="new-password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 10 characters"
          />
        </Field>
        <p className="meta" style={{ marginTop: 8 }}>
          {user.name} must change this at their next login, and all their existing sessions will be signed out.
        </p>
        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Resetting…' : 'Reset password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
