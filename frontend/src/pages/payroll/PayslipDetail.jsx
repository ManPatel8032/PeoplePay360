/**
 * Payslip Detail (B7) — itemized salary computation table showing every rule line
 * in sequence order, contract used, worked/leave days, and PDF download.
 */
import { useState } from 'react';
import { api, money, moneyExact } from '../../api.js';
import { useApi, States, Card, Table, Badge, Alert } from '../../components/ui.jsx';

const CAT_LABEL = { BASIC: 'Basic', ALW: 'Allowance', GROSS: 'Gross', DED: 'Deduction', NET: 'Net' };

export default function PayslipDetail({ payslipId, onBack }) {
  const [downloading, setDownloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState('');

  const { data: slip, loading, error, reload } = useApi(
    () => api.get(`/payslips/${payslipId}`), [payslipId]
  );

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetch(`/api/payslips/${payslipId}/pdf`, {
        headers: { 'x-user-id': String(localStorage.getItem('pp360.userId') || 1) },
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Download failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip-${slip.employee_name.replace(/\W+/g, '-')}-${slip.period_start}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message);
    } finally {
      setDownloading(false);
    }
  };

  const sendEmail = async () => {
    setSending(true);
    setSendMsg('');
    try {
      const res = await api.post(`/payslips/${payslipId}/send`);
      setSendMsg(`✓ Sent to ${res.to} (${res.mode})`);
    } catch (e) {
      setSendMsg(`✗ ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  const lineColumns = [
    { key: 'sequence', label: 'Seq', align: 'right' },
    { key: 'code', label: 'Code' },
    { key: 'name', label: 'Description' },
    { key: 'category', label: 'Category', render: (r) => CAT_LABEL[r.category] || r.category },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => (
      <span style={{
        fontWeight: ['GROSS', 'NET'].includes(r.category) ? 700 : 400,
        fontSize: ['GROSS', 'NET'].includes(r.category) ? 15 : 14,
        color: r.name.includes('formula error') ? 'var(--danger)' : undefined,
      }}>
        {moneyExact(r.amount)}
      </span>
    )},
  ];

  return (
    <>
      <div className="page-head">
        <div>
          <button className="btn btn-sm" onClick={onBack} style={{ marginBottom: 8 }}>← Back</button>
          <States loading={loading} error={error} empty={!slip} onRetry={reload}>
            {slip && (
              <>
                <h2>Payslip — {slip.employee_name}</h2>
                <p className="meta">
                  {slip.structure_name} · {slip.period_start} → {slip.period_end}
                  {slip.period_start && slip.period_end ? ` (${Math.round((new Date(slip.period_end) - new Date(slip.period_start)) / 86400000) + 1} days)` : ''} · <Badge value={slip.state} />
                </p>
              </>
            )}
          </States>
        </div>
        {slip && (
          <div className="row">
            <button className="btn" onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Downloading…' : '📄 Download PDF'}
            </button>
            <button className="btn" onClick={sendEmail} disabled={sending}>
              {sending ? 'Sending…' : '📧 Email'}
            </button>
          </div>
        )}
      </div>

      {sendMsg && (
        <Alert level={sendMsg.startsWith('✓') ? 'info' : 'error'}>
          <span>{sendMsg}</span>
        </Alert>
      )}

      {slip && (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Gross</div>
                <div className="kpi-value">{money(slip.gross)}</div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Net Payable</div>
                <div className="kpi-value" style={{ color: 'var(--accent)' }}>{money(slip.net)}</div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Worked Days</div>
                <div className="kpi-value">{slip.worked_days}</div>
                <div className="kpi-sub">{slip.leave_days} leave day(s)</div>
              </div>
            </Card>
            <Card>
              <div className="kpi">
                <div className="kpi-label">Contract</div>
                <div className="kpi-value" style={{ fontSize: 16 }}>
                  {slip.contract ? slip.contract.name : '—'}
                </div>
                <div className="kpi-sub">
                  {slip.contract ? `Contract Wage: ${moneyExact(slip.contract.wage)} / mo` : 'No contract found'}
                </div>
              </div>
            </Card>
          </div>

          {/* Warnings */}
          {slip.warnings?.length > 0 && (
            <div style={{ marginBottom: 16, display: 'grid', gap: 4 }}>
              {slip.warnings.map((w, i) => (
                <Alert key={i} level={w.level}>
                  <span>{w.message}</span>
                </Alert>
              ))}
            </div>
          )}

          {/* Salary Computation Table */}
          <Card>
            <div className="card-head">
              <h3>Salary Computation</h3>
              <span className="meta">{slip.lines?.length || 0} rule(s) in sequence order</span>
            </div>
            <Table columns={lineColumns} rows={slip.lines || []} empty="No computation lines yet — compute this payslip first" />

            {/* Net summary box */}
            {slip.lines?.length > 0 && (
              <div style={{
                marginTop: 16, padding: '12px 16px', borderRadius: 8,
                background: 'var(--accent)', color: 'var(--accent-fg)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontWeight: 600 }}>NET PAYABLE</span>
                <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {moneyExact(slip.net)}
                </span>
              </div>
            )}
          </Card>

          {/* Additional Info */}
          <div className="grid grid-2" style={{ marginTop: 16 }}>
            <Card>
              <h3 style={{ marginBottom: 8 }}>Details</h3>
              <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
                <div><span className="meta">Payrun:</span> {slip.payrun_name}</div>
                <div><span className="meta">Department:</span> {slip.department_name || '—'}</div>
                <div><span className="meta">Bank Account:</span> {slip.bank_account || <span style={{ color: 'var(--danger)' }}>Missing</span>}</div>
                <div><span className="meta">Email:</span> {slip.work_email || <span style={{ color: 'var(--warning)' }}>None</span>}</div>
                {slip.sent_at && <div><span className="meta">Sent At:</span> {new Date(slip.sent_at).toLocaleString()}</div>}
              </div>
            </Card>
            {slip.contract && (
              <Card>
                <h3 style={{ marginBottom: 8 }}>Contract Used</h3>
                <div style={{ display: 'grid', gap: 4, fontSize: 14 }}>
                  <div><span className="meta">Name:</span> {slip.contract.name}</div>
                  <div><span className="meta">Period:</span> {slip.contract.start_date} → {slip.contract.end_date || 'Open-ended'}</div>
                  <div><span className="meta">Wage:</span> {moneyExact(slip.contract.wage)}</div>
                  <div><span className="meta">State:</span> <Badge value={slip.contract.state} /></div>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </>
  );
}
