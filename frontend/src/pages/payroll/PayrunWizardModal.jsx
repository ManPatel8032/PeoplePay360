/**
 * Payrun Wizard Modal (B5) — two-step wizard.
 * Step 1: Pick structure, period, optional department/type scope.
 * Step 2: Fetch eligible employees, show blockers, checkbox selection.
 * Create action calls /api/payruns/wizard with only the selected employee IDs.
 */
import { useState } from 'react';
import { api, money } from '../../api.js';
import { useApi, Modal, Field, Badge, Alert } from '../../components/ui.jsx';

export default function PayrunWizardModal({ onClose, onCreated }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '', structure_id: '', period_start: '', period_end: '',
    department_id: '', employee_type: '',
  });
  const [eligible, setEligible] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { data: structures, error: structError } = useApi(() => api.get('/structures'), []);
  const { data: departments } = useApi(() => api.get('/departments'), []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const fetchEligible = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/payruns/eligible', {
        period_start: form.period_start,
        period_end: form.period_end,
        department_id: form.department_id || undefined,
        employee_type: form.employee_type || undefined,
      });
      setEligible(res);
      // Auto-select eligible employees (no blockers)
      setSelected(new Set(res.filter((e) => e.eligible && !e.blockers.length).map((e) => e.id)));
      setStep(2);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleAll = () => {
    const selectable = eligible.filter((e) => e.eligible && !e.blockers.length).map((e) => e.id);
    if (selected.size === selectable.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(selectable));
    }
  };

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createPayrun = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/payruns/wizard', {
        name: form.name || undefined,
        structure_id: Number(form.structure_id),
        period_start: form.period_start,
        period_end: form.period_end,
        department_id: form.department_id ? Number(form.department_id) : undefined,
        employee_ids: [...selected],
      });
      onCreated(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const canProceed = form.structure_id && form.period_start && form.period_end;

  return (
    <Modal title="New Payrun Wizard" onClose={onClose} width={720}>
      {error && <Alert level="error"><span>{error}</span></Alert>}
      {structError && (
        <Alert level="warning">
          <span>{structError.message}. Switch your role in the top-right corner to <strong>Arjun Patel (Payroll Manager)</strong> or <strong>Ishita Banerjee (Payroll Officer)</strong>.</span>
        </Alert>
      )}

      {step === 1 && (
        <>
          <div style={{ display: 'grid', gap: 16, marginTop: 8 }}>
            <Field label="Payrun Name (optional)">
              <input className="input" value={form.name} onChange={set('name')}
                     placeholder="Auto-generated if left blank" />
            </Field>
            <div className="grid grid-2">
              <Field label="Salary Structure *">
                <select className="select" value={form.structure_id} onChange={set('structure_id')}>
                  <option value="">Select structure…</option>
                  {(structures || []).filter((s) => s.active !== false).map((s) => (
                    <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                  ))}
                </select>
              </Field>
              <Field label="Department (optional)">
                <select className="select" value={form.department_id} onChange={set('department_id')}>
                  <option value="">All departments</option>
                  {(departments || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-2">
              <Field label="Period Start *">
                <input className="input" type="date" value={form.period_start} onChange={set('period_start')} />
              </Field>
              <Field label="Period End *">
                <input className="input" type="date" value={form.period_end} onChange={set('period_end')} />
              </Field>
            </div>
            <Field label="Employee Type (optional)">
              <select className="select" value={form.employee_type} onChange={set('employee_type')}>
                <option value="">All types</option>
                <option value="full_time">Full time</option>
                <option value="part_time">Part time</option>
                <option value="contract">Contract</option>
                <option value="intern">Intern</option>
              </select>
            </Field>
          </div>
          <div className="row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={fetchEligible} disabled={!canProceed || loading}>
              {loading ? 'Loading…' : 'Continue → Eligible Employees'}
            </button>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="meta" style={{ marginBottom: 12 }}>
            {eligible.length} employee(s) found · {selected.size} selected
          </p>

          <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr>
                  <th style={{ padding: '8px 12px', textAlign: 'left', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                    <input type="checkbox" onChange={toggleAll}
                           checked={selected.size > 0 && selected.size === eligible.filter((e) => e.eligible && !e.blockers.length).length} />
                  </th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Employee</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Department</th>
                  <th style={{ padding: '8px 12px', textAlign: 'right', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Wage</th>
                  <th style={{ padding: '8px 12px', textAlign: 'left', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {eligible.map((emp) => {
                  const blocked = !emp.eligible || emp.blockers.length > 0;
                  return (
                    <tr key={emp.id} style={{ opacity: blocked ? 0.5 : 1 }}>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                        <input type="checkbox" checked={selected.has(emp.id)} disabled={blocked}
                               onChange={() => toggle(emp.id)} />
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                        <div style={{ fontWeight: 500 }}>{emp.name}</div>
                        {emp.contract_name && <div className="meta">{emp.contract_name}</div>}
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>{emp.department_name || '—'}</td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {emp.wage ? money(emp.wage) : '—'}
                      </td>
                      <td style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>
                        {blocked ? (
                          <div>
                            {emp.blockers.map((b, i) => (
                              <div key={i} style={{ fontSize: 12, color: 'var(--danger)' }}>⚠ {b}</div>
                            ))}
                          </div>
                        ) : (
                          <Badge value="eligible" tone="success" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="row" style={{ marginTop: 24, justifyContent: 'flex-end' }}>
            <button className="btn" onClick={() => setStep(1)}>← Back</button>
            <button className="btn btn-primary" onClick={createPayrun} disabled={!selected.size || loading}>
              {loading ? 'Creating…' : `Create Payrun (${selected.size} employees)`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
