/**
 * Payrun Detail (B6) — processing view with state machine controls.
 * Compute → Validate → Mark Paid → Send Payslips
 * Shows warnings panel grouped by employee, payslip table with amounts.
 */
import { useState } from 'react';
import { api, money, moneyExact } from '../../api.js';
import { useApi, States, Card, Table, Badge, Alert, empNumberColumn } from '../../components/ui.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import PayslipDetail from './PayslipDetail.jsx';

const ACTIONS = {
  draft:     { label: 'Compute All', action: 'compute', next: 'Compute payslips for all employees in this run' },
  computed:  { label: 'Validate', action: 'validate', next: 'Lock this run — no further edits after validation' },
  validated: { label: 'Mark Paid', action: 'mark-paid', next: 'Confirm payment disbursement' },
  paid:      null,
};

export default function PayrunDetail({ payrunId, onBack }) {
  const [acting, setActing] = useState('');
  const [actionErr, setActionErr] = useState('');
  const [sendResult, setSendResult] = useState(null);
  const [selectedSlip, setSelectedSlip] = useState(null);

  const { data: run, loading, error, reload } = useApi(
    () => api.get(`/payruns/${payrunId}/detail`), [payrunId]
  );

  const doAction = async (action) => {
    setActing(action);
    setActionErr('');
    try {
      await api.post(`/payruns/${payrunId}/${action}`);
      reload();
    } catch (e) {
      setActionErr(e.message);
      // If blockers were returned, show them
      if (e.blockers) {
        setActionErr(`${e.message}\n\n${e.blockers.join('\n')}`);
      }
    } finally {
      setActing('');
    }
  };

  const sendPayslips = async () => {
    setActing('send');
    setActionErr('');
    try {
      const res = await api.post(`/payruns/${payrunId}/send-payslips`);
      setSendResult(res);
      reload();
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setActing('');
    }
  };

  if (selectedSlip) {
    return <PayslipDetail payslipId={selectedSlip} onBack={() => { setSelectedSlip(null); reload(); }} />;
  }

  const actionDef = run ? ACTIONS[run.state] : null;
  const { user, can } = useAuth();
  const canRunPayroll = can('payruns', 'write') !== 'none';
  const canDeleteRun = can('payruns', 'delete') !== 'none' && run && ['draft', 'computed'].includes(run.state);
  const canDeleteSlip = can('payslips', 'delete') !== 'none' && run && ['draft', 'computed'].includes(run.state);
  const isPaidOrValidated = run && ['validated', 'paid'].includes(run.state);
  const canSend = run && ['validated', 'paid'].includes(run.state);

  const deletePayrun = async () => {
    if (!confirm('Are you sure you want to delete this payrun? This cannot be undone.')) return;
    setActing('delete');
    setActionErr('');
    try {
      await api.del(`/payruns/${payrunId}`);
      onBack();
    } catch (e) {
      setActionErr(e.message);
    } finally {
      setActing('');
    }
  };

  // Collect all warnings across payslips, grouped by employee
  const allWarnings = (run?.payslips || []).flatMap((p) =>
    (p.warnings || []).map((w) => ({ ...w, employee: p.employee_name, payslip_id: p.id }))
  );
  const errorWarnings = allWarnings.filter((w) => w.level === 'error');
  const otherWarnings = allWarnings.filter((w) => w.level !== 'error');

  const slipColumns = [
    empNumberColumn,
    { key: 'employee_name', label: 'Employee' },
    { key: 'department_name', label: 'Department', render: (r) => r.department_name || '—' },
    { key: 'worked_days', label: 'Worked Days', align: 'right' },
    { key: 'leave_days', label: 'Leave Days', align: 'right' },
    { key: 'gross', label: 'Gross', align: 'right', render: (r) => money(r.gross) },
    { key: 'net', label: 'Net', align: 'right', render: (r) => (
      <strong>{money(r.net)}</strong>
    )},
    { key: 'state', label: 'State', render: (r) => <Badge value={r.state} /> },
    { key: 'warnings', label: 'Issues', align: 'right', render: (r) => {
      const errs = (r.warnings || []).filter((w) => w.level === 'error').length;
      const warns = (r.warnings || []).filter((w) => w.level === 'warning').length;
      if (!errs && !warns) return <span className="meta">—</span>;
      return (
        <span>
          {errs > 0 && <Badge value={`${errs} error`} tone="danger" />}
          {' '}
          {warns > 0 && <Badge value={`${warns} warn`} tone="warning" />}
        </span>
      );
    }},
    ...(canRunPayroll && run && ['draft', 'computed'].includes(run.state) ? [{
      key: 'recompute',
      label: '',
      align: 'right',
      render: (r) => {
        const isOwn = user?.employee_id && r.employee_id === user.employee_id && user?.role !== 'admin';
        if (isOwn) return null;
        return (
          <button
            type="button"
            className="btn btn-sm"
            style={{ padding: '2px 8px', minHeight: 24, fontSize: 12 }}
            title="Recompute this payslip"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                await api.post(`/payslips/${r.id}/compute`);
                reload();
              } catch (err) {
                setActionErr(err.message);
              }
            }}
          >
            ↻
          </button>
        );
      },
    }] : []),
    ...(canDeleteSlip ? [{
      key: 'remove',
      label: '',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          className="btn btn-sm btn-danger"
          style={{ padding: '2px 8px', minHeight: 24, fontSize: 12 }}
          title="Remove from payrun"
          onClick={async (e) => {
            e.stopPropagation();
            if (!confirm(`Remove ${r.employee_name} from this payrun?`)) return;
            try {
              await api.del(`/payslips/${r.id}`);
              reload();
            } catch (err) {
              setActionErr(err.message);
            }
          }}
        >
          ✕
        </button>
      ),
    }] : []),
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>← Back to Payruns</button>
          <States loading={loading} error={error} empty={!run} onRetry={reload}>
            {run && (
              <>
                <h2>{run.name}</h2>
                <p className="meta">
                  {run.structure_name} · {run.period_start} → {run.period_end}
                  {run.period_start && run.period_end ? ` (${Math.round((new Date(run.period_end) - new Date(run.period_start)) / 86400000) + 1} days)` : ''}
                  {run.department_name ? ` · ${run.department_name}` : ''}
                </p>
              </>
            )}
          </States>
        </div>
      </div>

      {run && (
        <>
          {/* Status Header with KPIs */}
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Card>
              <div className="kpi">
                <div className="kpi-label">State</div>
                <div style={{ marginTop: 4 }}><Badge value={run.state} /></div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Payslips</div>
                <div className="kpi-value">{run.payslip_count}</div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Total Net</div>
                <div className="kpi-value">{money(run.total_net)}</div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Blocking Issues</div>
                <div className="kpi-value" style={{ color: run.warning_count ? 'var(--danger)' : 'var(--success)' }}>
                  {run.warning_count}
                </div>
              </div>
            </Card>
          </div>

          {/* Action Buttons */}
          <Card style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Actions</h3>
              {isPaidOrValidated && <span className="meta">This payrun is a historical record and cannot be modified.</span>}
            </div>
            {actionErr && (
              <Alert level="error">
                <span style={{ whiteSpace: 'pre-wrap' }}>{actionErr}</span>
              </Alert>
            )}
            <div className="row" style={{ marginTop: 8, gap: 12 }}>
              {actionDef && canRunPayroll && (
                <div>
                  <button className="btn btn-primary" onClick={() => doAction(actionDef.action)}
                          disabled={!!acting || (actionDef.action === 'validate' && errorWarnings.length > 0)}>
                    {acting === actionDef.action ? `${actionDef.label}…` : actionDef.label}
                  </button>
                  <div className="meta" style={{ marginTop: 4 }}>{actionDef.next}</div>
                  {actionDef.action === 'validate' && errorWarnings.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                      ⚠ {errorWarnings.length} blocking error(s) must be resolved first
                    </div>
                  )}
                </div>
              )}
              {run.state === 'computed' && canRunPayroll && (
                <div>
                  <button className="btn btn-secondary" onClick={() => doAction('compute')}
                          disabled={!!acting}>
                    {acting === 'compute' ? 'Recomputing…' : '↻ Recompute All'}
                  </button>
                  <div className="meta" style={{ marginTop: 4 }}>Recalculate payslips and refresh warnings</div>
                </div>
              )}
              {canSend && canRunPayroll && (
                <div>
                  <button className="btn" onClick={sendPayslips} disabled={!!acting}>
                    {acting === 'send' ? 'Sending…' : '📧 Send Payslips'}
                  </button>
                  <div className="meta" style={{ marginTop: 4 }}>Email PDF payslips to all employees</div>
                </div>
              )}
              {canDeleteRun && (
                <div>
                  <button className="btn btn-danger" onClick={deletePayrun} disabled={!!acting}>
                    {acting === 'delete' ? 'Deleting…' : 'Delete Payrun'}
                  </button>
                  <div className="meta" style={{ marginTop: 4 }}>Permanently delete this unvalidated run</div>
                </div>
              )}
              {run.state === 'draft' && (
                <div className="meta" style={{ padding: 8, color: 'var(--text-muted)' }}>
                  Click "Compute All" to calculate payslips for all employees in this run.
                </div>
              )}
            </div>
          </Card>

          {/* Send Results */}
          {sendResult && (
            <Card style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3>📧 Send Results</h3>
                <Badge value={`${sendResult.sent}/${sendResult.total} sent`}
                       tone={sendResult.sent === sendResult.total ? 'success' : 'warning'} />
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {sendResult.results.map((r, i) => (
                  <div key={i} style={{ padding: '4px 0', fontSize: 13,
                    color: r.ok ? 'var(--success)' : 'var(--danger)' }}>
                    {r.ok ? '✓' : '✗'} {r.employee} — {r.ok ? (r.mode === 'outbox' ? 'saved to outbox' : 'sent') : r.reason}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Warnings Panel */}
          {allWarnings.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <div className="card-head">
                <h3>⚠ Warnings</h3>
                <span className="meta">{allWarnings.length} total</span>
              </div>
              {errorWarnings.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--danger)', marginBottom: 4 }}>
                    BLOCKING — must resolve before validation
                  </div>
                  {errorWarnings.map((w, i) => (
                    <Alert key={i} level="error">
                      <span><strong>{w.employee}:</strong> {w.message}</span>
                    </Alert>
                  ))}
                </div>
              )}
              {otherWarnings.length > 0 && (
                <div>
                  {otherWarnings.map((w, i) => (
                    <Alert key={i} level={w.level}>
                      <span><strong>{w.employee}:</strong> {w.message}</span>
                    </Alert>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Payslip Table */}
          <Card>
            <div className="card-head">
              <h3>Payslips</h3>
            </div>
            <Table columns={slipColumns} rows={run.payslips} onRowClick={(r) => setSelectedSlip(r.id)} />
          </Card>
        </>
      )}
    </>
  );
}
