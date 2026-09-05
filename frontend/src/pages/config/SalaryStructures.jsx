/**
 * Salary Structures (A5) — list with create/edit modal.
 * Shows rule count, employee count, and active/inactive toggle.
 */
import { useState } from 'react';
import { api } from '../../api.js';
import { useApi, States, Table, Badge, Modal, Field } from '../../components/ui.jsx';

const empty = { name: '', code: '', active: true };

export default function SalaryStructures({ onSelect }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const { data, loading, error: loadErr, reload } = useApi(() => api.get('/structures'), []);

  const open = (row) => {
    setForm(row ? { name: row.name, code: row.code, active: row.active } : { ...empty });
    setEditing(row || {});
    setError('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (editing.id) {
        await api.patch(`/structures/${editing.id}`, form);
      } else {
        await api.post('/structures', form);
      }
      setEditing(null);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (row) => {
    try {
      await api.patch(`/structures/${row.id}`, { active: !row.active });
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code' },
    { key: 'active', label: 'Status', render: (r) => (
      <Badge value={r.active ? 'active' : 'inactive'} />
    )},
    { key: 'rule_count', label: 'Rules', align: 'right' },
    { key: 'employee_count', label: 'Employees', align: 'right' },
    { key: 'actions', label: '', render: (r) => (
      <div className="row">
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); open(r); }}>Edit</button>
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); toggle(r); }}>
          {r.active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    )},
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Salary Structures</h2>
          <p className="meta">Define pay calculation templates for employee contracts</p>
        </div>
        <button className="btn btn-primary" onClick={() => open(null)}>+ New Structure</button>
      </div>

      <States loading={loading} error={loadErr} empty={!data?.length} onRetry={reload}>
        <Table columns={columns} rows={data} onRowClick={(r) => onSelect ? onSelect(r) : open(r)} />
      </States>

      {editing && (
        <Modal title={editing.id ? 'Edit Structure' : 'New Structure'} onClose={() => setEditing(null)}>
          {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
          <div style={{ display: 'grid', gap: 16 }}>
            <Field label="Name">
              <input className="input" value={form.name}
                     onChange={(e) => setForm({ ...form, name: e.target.value })}
                     placeholder="e.g. Standard Indian Payroll" autoFocus />
            </Field>
            <Field label="Code">
              <input className="input" value={form.code}
                     onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                     placeholder="e.g. STD_IN" disabled={!!editing.id} />
            </Field>
            <Field label="Active">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                <input type="checkbox" checked={form.active}
                       onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                Structure is active and available for contracts
              </label>
            </Field>
          </div>
          <div className="row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={save} disabled={saving || !form.name || !form.code}>
              {saving ? 'Saving…' : editing.id ? 'Save Changes' : 'Create Structure'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
