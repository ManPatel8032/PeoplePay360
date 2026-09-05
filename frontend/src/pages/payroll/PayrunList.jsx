/**
 * Payrun List (B5) — table of all payruns with state badges, period, total net.
 * "New Payrun" opens the wizard modal.
 */
import { useState } from 'react';
import { api, qs, money } from '../../api.js';
import { useApi, States, Table, Badge } from '../../components/ui.jsx';
import PayrunWizardModal from './PayrunWizardModal.jsx';

export default function PayrunList({ onSelect }) {
  const [showWizard, setShowWizard] = useState(false);
  const [filters, setFilters] = useState({ state: '', structure_id: '' });

  const { data, loading, error, reload } = useApi(
    () => api.get(`/payruns${qs(filters)}`), [filters.state, filters.structure_id]
  );
  const { data: structures } = useApi(() => api.get('/structures'), []);

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'structure_name', label: 'Structure' },
    { key: 'period', label: 'Period', render: (r) => `${r.period_start} → ${r.period_end}` },
    { key: 'department_name', label: 'Department', render: (r) => r.department_name || 'All' },
    { key: 'state', label: 'State', render: (r) => <Badge value={r.state} /> },
    { key: 'payslip_count', label: 'Payslips', align: 'right' },
    { key: 'total_net', label: 'Total Net', align: 'right', render: (r) => money(r.total_net) },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>Payruns</h2>
          <p className="meta">Batch payroll processing — create, compute, validate, and disburse</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowWizard(true)}>+ New Payrun</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="grid grid-3">
          <div className="field">
            <label>State</label>
            <select className="select" value={filters.state} onChange={set('state')}>
              <option value="">All states</option>
              <option value="draft">Draft</option>
              <option value="computed">Computed</option>
              <option value="validated">Validated</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <div className="field">
            <label>Structure</label>
            <select className="select" value={filters.structure_id} onChange={set('structure_id')}>
              <option value="">All structures</option>
              {(structures || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <States loading={loading} error={error} empty={!data?.length}
             emptyText="No payruns yet — create one with the wizard" onRetry={reload}>
        <Table columns={columns} rows={data} onRowClick={onSelect} />
      </States>

      {showWizard && (
        <PayrunWizardModal
          onClose={() => setShowWizard(false)}
          onCreated={(run) => { setShowWizard(false); reload(); onSelect?.(run); }}
        />
      )}
    </>
  );
}
