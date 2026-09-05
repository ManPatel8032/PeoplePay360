/**
 * Salary Rules (A6) — rule editor with sequence ordering, compute type switching,
 * and live preview tester calling /api/rules/preview.
 */
import { useState, useMemo } from 'react';
import { api, moneyExact } from '../../api.js';
import { useApi, States, Table, Badge, Modal, Field, Alert, SearchInput } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';


const CATEGORIES = ['BASIC', 'ALW', 'GROSS', 'DED', 'NET'];
const COMPUTE_TYPES = ['fixed', 'percent', 'formula'];
const emptyRule = {
  structure_id: '', name: '', code: '', category: 'BASIC',
  sequence: 100, compute_type: 'fixed', amount: 0, percent_base: '', formula: '', active: true,
};

export default function SalaryRules({ structureId, structureName, onBack }) {
  // Payroll User has read-only access to rules; only Payroll Manager and Admin edit and preview.
  const { user, can } = useAuth();
  const canEditRules = can('rules', 'write') !== 'none';
  const canDeleteRules = can('rules', 'delete') !== 'none';
  const isPayrollUser = user?.role === 'payroll_user';
  const canShowPreview = !isPayrollUser && canEditRules;

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewErr, setPreviewErr] = useState('');
  const [previewForm, setPreviewForm] = useState({ employee_id: '', period_start: '', period_end: '' });

  const { data: rules, loading, error: loadErr, reload } = useApi(
    () => api.get(`/structures/${structureId}/rules`), [structureId]
  );
  const { data: employees } = useApi(() => api.get('/employees'), []);

  const visible = useMemo(() => {
    if (!rules) return [];
    if (!search.trim()) return rules;
    const q = search.trim().toLowerCase();
    return rules.filter((r) =>
      r.name?.toLowerCase().includes(q) ||
      r.code?.toLowerCase().includes(q) ||
      r.category?.toLowerCase().includes(q)
    );
  }, [rules, search]);


  const open = (row) => {
    if (!row && !canEditRules) return;
    setForm(row
      ? { ...emptyRule, ...row }
      : { ...emptyRule, structure_id: structureId, sequence: (rules?.length || 0) * 10 + 10 }
    );
    setEditing(row || {});
    setError('');
  };

  const save = async () => {
    if (!canEditRules) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, structure_id: structureId };
      if (editing.id) {
        await api.patch(`/rules/${editing.id}`, payload);
      } else {
        await api.post('/rules', payload);
      }
      setEditing(null);
      reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    if (!canDeleteRules) return;
    if (!confirm('Delete this rule? This cannot be undone.')) return;
    try {
      await api.del(`/rules/${id}`);
      reload();
    } catch (e) {
      setError(e.message);
    }
  };

  const runPreview = async () => {
    if (!canShowPreview) return;
    setPreviewLoading(true);
    setPreviewErr('');
    try {
      const res = await api.post('/rules/preview', {
        structure_id: structureId,
        ...previewForm,
      });
      setPreview(res);
    } catch (e) {
      setPreviewErr(e.message);
    } finally {
      setPreviewLoading(false);
    }
  };

  const catLabel = { BASIC: 'Basic', ALW: 'Allowance', GROSS: 'Gross', DED: 'Deduction', NET: 'Net' };

  const columns = [
    { key: 'sequence', label: 'Seq', align: 'right' },
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', render: (r) => <Badge value={r.category} /> },
    {
      key: 'compute_type',
      label: 'Computation / Formula',
      render: (r) => {
        if (r.compute_type === 'fixed') {
          return <span className="meta">Fixed {moneyExact(r.amount)}</span>;
        }
        if (r.compute_type === 'percent') {
          return <span className="meta">{r.amount}% of <code>{r.percent_base}</code></span>;
        }
        return (
          <code
            style={{
              fontSize: 12,
              background: 'var(--surface-sunken, #f1f5f9)',
              padding: '2px 6px',
              borderRadius: 4,
              fontFamily: 'monospace',
              display: 'inline-block',
              maxWidth: 320,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={r.formula}
          >
            {r.formula || '—'}
          </code>
        );
      },
    },
    { key: 'active', label: 'Active', render: (r) => <Badge value={r.active ? 'active' : 'inactive'} /> },
    { key: 'actions', label: '', render: (r) => (canEditRules ? (
      <div className="row">
        <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); open(r); }}>Edit</button>
        {canDeleteRules && (
          <button className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); remove(r.id); }}>Delete</button>
        )}
      </div>
    ) : (
      <button className="btn btn-sm" onClick={(e) => { e.stopPropagation(); open(r); }}>View Rule</button>
    ))},
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>← Back to Structures</button>
          <h2>Rules — {structureName}</h2>
          <p className="meta">Define and sequence salary computation rules. Rules execute top-to-bottom by sequence number.</p>
        </div>
        {canEditRules && <button className="btn btn-primary" onClick={() => open(null)}>+ New Rule</button>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ maxWidth: 350 }}>
          <SearchInput
            placeholder="Search rule name, code, category..."
            value={search}
            onChange={setSearch}
          />
        </div>
      </div>

      <States loading={loading} error={loadErr} empty={!visible?.length}
             emptyText="No rules yet — add your first rule to define the salary computation" onRetry={reload}>
        <Table columns={columns} rows={visible} onRowClick={open} />
      </States>


      {/* Rule Preview Panel */}
      {canShowPreview && (
        <div style={{ marginTop: 24 }}>
          <div className="card">
            <div className="card-head">
              <h3>🧪 Rule Preview</h3>
            </div>
            <p className="meta" style={{ marginBottom: 12 }}>
              Test this structure's rules against a real employee and period to see computed amounts.
            </p>
            <div className="grid grid-3" style={{ marginBottom: 16 }}>
              <Field label="Employee">
                <select className="select" value={previewForm.employee_id}
                        onChange={(e) => setPreviewForm({ ...previewForm, employee_id: e.target.value })}>
                  <option value="">Select employee…</option>
                  {(employees || []).map((emp) => (
                    <option key={emp.id} value={emp.id}>{emp.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Period Start">
                <input className="input" type="date" value={previewForm.period_start}
                       onChange={(e) => setPreviewForm({ ...previewForm, period_start: e.target.value })} />
              </Field>
              <Field label="Period End">
                <input className="input" type="date" value={previewForm.period_end}
                       onChange={(e) => setPreviewForm({ ...previewForm, period_end: e.target.value })} />
              </Field>
            </div>
            <button className="btn btn-primary btn-sm" onClick={runPreview}
                    disabled={previewLoading || !previewForm.employee_id || !previewForm.period_start || !previewForm.period_end}>
              {previewLoading ? 'Computing…' : 'Run Preview'}
            </button>

            {previewErr && <Alert level="error"><span>{previewErr}</span></Alert>}

            {preview && (
              <div style={{ marginTop: 16 }}>
                <div className="grid grid-4" style={{ marginBottom: 16 }}>
                  <div className="card kpi">
                    <div className="kpi-label">Gross</div>
                    <div className="kpi-value" style={{ fontSize: 20 }}>{moneyExact(preview.gross)}</div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-label">Net</div>
                    <div className="kpi-value" style={{ fontSize: 20 }}>{moneyExact(preview.net)}</div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-label">Working Days</div>
                    <div className="kpi-value" style={{ fontSize: 20 }}>{preview.stats?.workingDays ?? '—'}</div>
                  </div>
                  <div className="card kpi">
                    <div className="kpi-label">Contract Wage</div>
                    <div className="kpi-value" style={{ fontSize: 20 }}>{moneyExact(preview.contract?.wage)}</div>
                  </div>
                </div>
                <Table
                  columns={[
                    { key: 'sequence', label: 'Seq', align: 'right' },
                    { key: 'code', label: 'Code' },
                    { key: 'name', label: 'Description' },
                    { key: 'category', label: 'Category', render: (r) => catLabel[r.category] || r.category },
                    { key: 'amount', label: 'Amount', align: 'right', render: (r) => (
                      <span style={{
                        fontWeight: ['GROSS', 'NET'].includes(r.category) ? 700 : 400,
                        color: r.error ? 'var(--danger)' : undefined,
                      }}>
                        {r.error ? `Error: ${r.error}` : moneyExact(r.amount)}
                      </span>
                    )},
                  ]}
                  rows={preview.lines}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit / View Details Modal */}
      {editing && (
        <Modal
          title={!canEditRules ? `Salary Rule Details: ${editing.name || ''} (${editing.code || ''})` : editing.id ? `Edit Rule: ${editing.name}` : 'New Rule'}
          onClose={() => setEditing(null)}
          width={640}
        >
          <fieldset disabled={!canEditRules} style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
            <div style={{ display: 'grid', gap: 16 }}>
              <div className="grid grid-2">
                <Field label="Name">
                  <input className="input" value={form.name}
                         onChange={(e) => setForm({ ...form, name: e.target.value })}
                         placeholder="e.g. Basic Salary" autoFocus={canEditRules} />
                </Field>
                <Field label="Code">
                  <input className="input" value={form.code}
                         onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') })}
                         placeholder="e.g. BASIC" disabled={!canEditRules || !!editing.id} />
                </Field>
              </div>
              <div className="grid grid-3">
                <Field label="Category">
                  <select className="select" value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{catLabel[c]}</option>)}
                  </select>
                </Field>
                <Field label="Sequence">
                  <input className="input" type="number" value={form.sequence}
                         onChange={(e) => setForm({ ...form, sequence: Number(e.target.value) })} />
                </Field>
                <Field label="Compute Type">
                  <select className="select" value={form.compute_type}
                          onChange={(e) => setForm({ ...form, compute_type: e.target.value })}>
                    {COMPUTE_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                  </select>
                </Field>
              </div>

              {form.compute_type === 'fixed' && (
                <Field label="Amount (fixed value)">
                  <input className="input" type="number" step="0.01" value={form.amount}
                         onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </Field>
              )}
              {form.compute_type === 'percent' && (
                <div className="grid grid-2">
                  <Field label="Percentage">
                    <input className="input" type="number" step="0.01" value={form.amount}
                           onChange={(e) => setForm({ ...form, amount: e.target.value })}
                           placeholder="e.g. 40 for 40%" />
                  </Field>
                  <Field label="Percent Base (rule code or category)">
                    <input className="input" value={form.percent_base}
                           onChange={(e) => setForm({ ...form, percent_base: e.target.value })}
                           placeholder="e.g. BASIC or ALW" />
                  </Field>
                </div>
              )}
              {form.compute_type === 'formula' && (
                <Field label="Formula (JavaScript expression)">
                  <textarea className="input" rows={4} value={form.formula || ''}
                            onChange={(e) => setForm({ ...form, formula: e.target.value })}
                            placeholder="e.g. RULE.GROSS - CAT.DED"
                            style={{ fontFamily: 'monospace', fontSize: 13 }} />
                  <span className="meta">
                    Available: wage, worked_days, working_days, attended_days, overtime_hours,
                    paid_leave_days, unpaid_leave_days, RULE.&lt;CODE&gt;, CAT.&lt;CATEGORY&gt;
                  </span>
                </Field>
              )}

              <Field label="Active">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: canEditRules ? 'pointer' : 'default' }}>
                  <input type="checkbox" checked={form.active}
                         onChange={(e) => setForm({ ...form, active: e.target.checked })} />
                  Include this rule in salary computations
                </label>
              </Field>
            </div>
          </fieldset>
          <div className="row" style={{ marginTop: 24, justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              {editing.id && canDeleteRules && (
                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() => {
                    const id = editing.id;
                    setEditing(null);
                    remove(id);
                  }}
                >
                  Delete Rule
                </button>
              )}
            </div>
            <div className="row">
              <button className="btn" onClick={() => setEditing(null)}>
                {canEditRules ? 'Cancel' : 'Close'}
              </button>
              {canEditRules && (
                <button className="btn btn-primary" onClick={save} disabled={saving || !form.name || !form.code}>
                  {saving ? 'Saving…' : editing.id ? 'Save Changes' : 'Create Rule'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
