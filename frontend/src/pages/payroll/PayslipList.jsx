/**
 * Payslip List (B7) — standalone filterable list of all payslips across payruns.
 * Respects scopeToSelf on the backend — employees see only their own.
 */
import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, qs, money } from '../../api.js';
import { useApi, States, Table, Badge, empNumberColumn, SearchInput } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import PayslipDetail from './PayslipDetail.jsx';

export default function PayslipList() {
  const { can } = useAuth();
  const canDeleteSlip = can('payslips', 'delete') !== 'none';

  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = searchParams.get('state') || '';
  const urlSearch = searchParams.get('search') || '';
  const urlEmp = searchParams.get('employee_id') || '';
  const urlRun = searchParams.get('payrun_id') || '';
  const [filters, setFilters] = useState({ payrun_id: urlRun, employee_id: urlEmp, state: urlState });
  const [search, setSearch] = useState(urlSearch);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    const s = searchParams.get('state') || '';
    const q = searchParams.get('search') || '';
    const emp = searchParams.get('employee_id') || '';
    const run = searchParams.get('payrun_id') || '';
    setFilters((f) => ({ ...f, state: s, employee_id: emp, payrun_id: run }));
    if (q) setSearch(q);
  }, [searchParams]);

  const { data, loading, error, reload } = useApi(
    () => api.get(`/payslips${qs(filters)}`), [filters.payrun_id, filters.employee_id, filters.state]
  );

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  const deleteSlip = async (r, e) => {
    e.stopPropagation();
    if (!confirm(`Permanently delete payslip for ${r.employee_name}? This cannot be undone.`)) return;
    try {
      await api.del(`/payslips/${r.id}`);
      reload();
    } catch (err) {
      alert(err.message);
    }
  };

  const visible = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.trim().toLowerCase();
    return data.filter((r) =>
      r.employee_name?.toLowerCase().includes(q) ||
      r.employee_number?.toLowerCase().includes(q) ||
      r.payrun_name?.toLowerCase().includes(q) ||
      r.department_name?.toLowerCase().includes(q)
    );
  }, [data, search]);

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
    ...(canDeleteSlip ? [{
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (!['validated', 'paid'].includes(r.state) ? (
        <button
          className="btn btn-sm btn-danger"
          style={{ padding: '2px 8px', minHeight: 26, fontSize: 12 }}
          onClick={(e) => deleteSlip(r, e)}
        >
          Delete
        </button>
      ) : null),
    }] : []),
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
            <label>Search Payslips</label>
            <SearchInput
              placeholder="Search employee, number, or payrun..."
              value={search}
              onChange={setSearch}
            />
          </div>
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
          {filters.employee_id && (
            <div className="field" style={{ alignSelf: 'flex-end' }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => {
                  setFilters((f) => ({ ...f, employee_id: '' }));
                  const next = new URLSearchParams(searchParams);
                  next.delete('employee_id');
                  setSearchParams(next);
                }}
              >
                Clear Employee Filter ✕
              </button>
            </div>
          )}
        </div>
      </div>

      <States loading={loading} error={error} empty={!visible?.length}
             emptyText="No payslips found" onRetry={reload}>
        <Table columns={columns} rows={visible} onRowClick={(r) => setSelectedId(r.id)} />
      </States>
    </>
  );
}

