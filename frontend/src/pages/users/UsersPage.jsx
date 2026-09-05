/**
 * User Administration (Admin only).
 *
 * Employee-centric: every employee is listed whether or not they hold a login,
 * so an admin can see at a glance who still needs an account. Logins with no
 * employee record (the IT admin) appear at the end.
 */
import { useMemo, useState } from 'react';
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

const isLocked = (r) => r.locked_until && new Date(r.locked_until) > new Date();
const hasLogin = (r) => Boolean(r.user_id);

const fmtDate = (v) =>
  v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Never';

export default function UsersPage() {
  const { user: me } = useAuth();
  const rows = useApi(() => api.get('/users'), []);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(null);   // employee row, or {} for a standalone login
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [banner, setBanner] = useState(null);

  const say = (msg) => { setBanner(msg); setTimeout(() => setBanner(null), 4000); };
  const all = rows.data || [];

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((r) => {
      if (filter === 'with' && !hasLogin(r)) return false;
      if (filter === 'without' && hasLogin(r)) return false;
      if (!q) return true;
      return [r.employee_name, r.name, r.email, r.work_email, r.employee_number, r.department_name]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [all, filter, search]);

  async function toggleActive(r) {
    try {
      await api.patch(`/users/${r.user_id}`, { is_active: !r.is_active });
      say(`${r.name} ${r.is_active ? 'deactivated' : 'reactivated'}.`);
      rows.reload();
    } catch (err) { say(err.message); }
  }

  async function unlock(r) {
    try {
      await api.post(`/users/${r.user_id}/unlock`);
      say(`${r.name} unlocked.`);
      rows.reload();
    } catch (err) { say(err.message); }
  }

  const columns = [
    {
      key: 'employee_number', label: 'Emp. No.',
      render: (r) => r.employee_number
        ? <span className="mono">{r.employee_number}</span>
        : <span className="muted">—</span>,
    },
    {
      key: 'person', label: 'Person',
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {r.employee_name || r.name}
            {r.user_id === me?.id && <span className="meta"> (you)</span>}
          </div>
          <div className="meta">{r.email || r.work_email || 'No email on record'}</div>
        </div>
      ),
    },
    {
      key: 'department_name', label: 'Department',
      render: (r) => r.department_name
        ? <div>{r.department_name}<div className="meta">{r.job_position_name || '—'}</div></div>
        : <span className="muted">No employee record</span>,
    },
    {
      key: 'manager_name', label: 'Reports to',
      render: (r) => (
        <div>
          <div>{r.manager_name || (r.employee_id ? 'Top level' : '—')}</div>
          {r.direct_reports > 0 && <div className="meta">manages {r.direct_reports}</div>}
        </div>
      ),
    },
    {
      key: 'role', label: 'Login',
      render: (r) => hasLogin(r)
        ? <Badge value={roleLabel(r.role)} tone="accent" />
        : <span className="badge">no account</span>,
    },
    {
      // Admin accounts carry no status field — they cannot be deactivated here.
      key: 'status', label: 'Status',
      render: (r) => {
        if (!hasLogin(r)) return <span className="muted">—</span>;
        if (r.role === 'admin') return <span className="muted">—</span>;
        if (!r.is_active) return <Badge value="inactive" tone="danger" />;
        if (isLocked(r)) return <Badge value="locked" tone="warning" />;
        if (r.must_change_password) return <Badge value="must reset" tone="warning" />;
        return <Badge value="active" tone="success" />;
      },
    },
    { key: 'last_login_at', label: 'Last login', render: (r) => <span className="meta">{hasLogin(r) ? fmtDate(r.last_login_at) : '—'}</span> },
    {
      key: 'actions', label: '', align: 'right',
      render: (r) => {
        if (!hasLogin(r)) {
          return (
            <button className="btn btn-sm btn-primary" onClick={() => setCreating(r)}>
              Create login
            </button>
          );
        }
        const isAdminRow = r.role === 'admin';
        return (
          <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
            <button className="btn btn-sm" onClick={() => setEditing(r)}>Edit</button>
            <button className="btn btn-sm" onClick={() => setResetting(r)}>Reset password</button>
            {isLocked(r) && <button className="btn btn-sm" onClick={() => unlock(r)}>Unlock</button>}
            {/* No activate/deactivate control on admin accounts. */}
            {!isAdminRow && (
              <button
                className={`btn btn-sm ${r.is_active ? 'btn-danger' : ''}`}
                onClick={() => toggleActive(r)}
              >
                {r.is_active ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
          </div>
        );
      },
    },
  ];

  const withLogin = all.filter(hasLogin).length;
  const withoutLogin = all.filter((r) => r.employee_id && !hasLogin(r)).length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>User Administration</h1>
          <p className="meta">Every employee, and whether they hold a login. Admin only.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating({})}>+ New Login</button>
      </div>

      {banner && <div style={{ marginBottom: 16 }}><Alert level="info">{banner}</Alert></div>}

      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <Card><div className="kpi"><div className="kpi-label">Employees</div><div className="kpi-value">{all.filter((r) => r.employee_id).length}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">With a login</div><div className="kpi-value">{withLogin}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">No account yet</div><div className="kpi-value">{withoutLogin}</div></div></Card>
        <Card><div className="kpi"><div className="kpi-label">Locked out</div><div className="kpi-value">{all.filter(isLocked).length}</div></div></Card>
      </div>

      <Card className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <input
            className="input" style={{ maxWidth: 300 }} placeholder="Search name, number, email…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
          <select className="select" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">Everyone</option>
            <option value="with">Has a login</option>
            <option value="without">No account yet</option>
          </select>
          <span className="meta">{visible.length} shown</span>
        </div>
      </Card>

      <States loading={rows.loading} error={rows.error} onRetry={rows.reload} empty={!rows.loading && visible.length === 0}>
        <Table columns={columns} rows={visible.map((r) => ({ ...r, id: r.user_id ?? `e${r.employee_id}` }))} empty="Nobody matches that filter" />
      </States>

      {creating && (
        <UserFormModal
          employee={creating.employee_id ? creating : null}
          onClose={() => setCreating(null)}
          onSaved={(n) => { setCreating(null); say(`${n} can now sign in.`); rows.reload(); }}
        />
      )}
      {editing && (
        <UserFormModal
          user={editing}
          isSelf={editing.user_id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={(n) => { setEditing(null); say(`${n} updated.`); rows.reload(); }}
        />
      )}
      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSaved={() => { const n = resetting.name; setResetting(null); say(`Password reset for ${n}.`); rows.reload(); }}
        />
      )}
    </>
  );
}

function UserFormModal({ user, employee, isSelf, onClose, onSaved }) {
  const editing = Boolean(user?.user_id);
  const linkable = useApi(() => api.get('/users/linkable/employees'), []);

  const [form, setForm] = useState({
    name: user?.name || employee?.employee_name || '',
    email: user?.email || employee?.work_email || '',
    role: user?.role || 'employee',
    employee_id: user?.employee_id ? String(user.employee_id)
      : employee?.employee_id ? String(employee.employee_id) : '',
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
        const payload = { name: form.name.trim(), employee_id: form.employee_id ? Number(form.employee_id) : null };
        if (!isSelf) payload.role = form.role;
        await api.patch(`/users/${user.user_id}`, payload);
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

  const options = [...(linkable.data || [])];
  if (employee?.employee_id && !options.some((o) => o.id === employee.employee_id)) {
    options.unshift({ id: employee.employee_id, name: employee.employee_name, department_name: employee.department_name });
  }
  if (editing && user.employee_id && !options.some((o) => o.id === user.employee_id)) {
    options.unshift({ id: user.employee_id, name: user.employee_name, department_name: user.department_name });
  }

  const title = editing ? `Edit ${user.name}`
    : employee ? `Create login — ${employee.employee_name}`
    : 'New Login';

  return (
    <Modal title={title} onClose={onClose} width={560}>
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
            <span className="meta">Only employees without an account are listed.</span>
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
            <input className="input" type="email" value={form.email} onChange={set('email')} disabled={editing} />
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
                <span className="meta">Share this with them — they must change it at first login.</span>
              </Field>
            </div>
          )}
        </div>

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 20 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Create login'}
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
      await api.post(`/users/${user.user_id}/reset-password`, { newPassword: password });
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
          They must change this at next login, and all their sessions will be signed out.
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
