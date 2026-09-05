/**
 * Payslip List (B7) — standalone filterable list of all payslips across payruns.
 * Respects scopeToSelf on the backend — employees see only their own.
 */
import { useState } from 'react';
import { api, qs, money } from '../../api.js';
import { useApi, States, Table, Badge, empNumberColumn } from '../../components/ui.jsx';
import PayslipDetail from './PayslipDetail.jsx';

export default function PayslipList() {
  const [filters, setFilters] = useState({ payrun_id: '', employee_id: '', state: '' });
  const [selectedId, setSelectedId] = useState(null);

  const { data, loading, error, reload } = useApi(
    () => api.get(`/payslips${qs(filters)}`), [filters.payrun_id, filters.employee_id, filters.state]
  );

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  if (selectedId) {
    return <PayslipDetail payslipId={selectedId} onBack={() => { setSelectedId(null); reload(); }} />;
  }

  const columns = [
    empNumberColumn,
    { key: 'employee_name', label: 'Employee' },
    { key: 'payrun_name', label: 'Payrun' },
    { key: 'period', label: 'Period', render: (r) => `${r.period_start} → ${r.period_end}` },
    { key: 'department_name', label: 'Department', render: (r) => r.department_name || '—' },
    { key: 'gross', label: 'Gross', align: 'right', render: (r) => money(r.gross) },
    { key: 'net', label: 'Net', align: 'right', render: (r) => <strong>{money(r.net)}</strong> },
    { key: 'state', label: 'State', render: (r) => <Badge value={r.state} /> },
    { key: 'sent_at', label: 'Sent', render: (r) => r.sent_at ? '✓' : '—' },
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <h2>All Payslips</h2>
          <p className="meta">Individual payslips across all payruns</p>
        </div>
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
        </div>
      </div>

      <States loading={loading} error={error} empty={!data?.length}
             emptyText="No payslips found" onRetry={reload}>
        <Table columns={columns} rows={data} onRowClick={(r) => setSelectedId(r.id)} />
      </States>
    </>
  );
}
