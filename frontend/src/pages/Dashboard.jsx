/**
 * Payroll Dashboard (B9) — the vertical slice proving the whole pipe works:
 * Postgres -> aggregation SQL -> API -> live charts. Every number is derived
 * from real records; nothing here is hardcoded.
 *
 * Owned by Track C after handoff, but usable by everyone as a reference page.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { api, qs, money } from '../api.js';
import { useApi, States, Card, Kpi, Table, Badge, Alert } from '../components/ui.jsx';

const monthsAgo = (n) => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 1)).toISOString().slice(0, 10);
};
const endOfThisMonth = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
};

/** Normalizes alert links to ensure proper query parameters and prevent 404s. */
function resolveAlertLink(a) {
  if (!a?.link) return null;
  if (a.link === '/payruns') return '/payroll?tab=payslips&state=draft';
  if (a.link === '/payslips') return '/payroll?tab=payslips';
  if (a.link === '/time-off/requests') return '/time-off?tab=requests&state=to_approve';
  if (a.link === '/attendance' && a.message?.toLowerCase().includes('check-out')) {
    return '/attendance?missing_checkout=true';
  }
  if (a.link === '/employees' && a.message?.toLowerCase().includes('bank')) {
    return '/employees?missing_bank=true';
  }
  if (a.link === '/contracts' && a.message?.toLowerCase().includes('without a contract')) {
    return '/contracts?missing=true';
  }
  if (a.link === '/contracts' && a.message?.toLowerCase().includes('expiring')) {
    return '/contracts?expiring=true';
  }
  return a.link;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState({
    period_start: monthsAgo(5),
    period_end: endOfThisMonth(),
    department_id: '',
    employee_type: '',
  });

  const departments = useApi(() => api.get('/departments'), []);
  const { data, loading, error, reload } = useApi(
    () => api.get(`/dashboard${qs(filters)}`),
    [filters.period_start, filters.period_end, filters.department_id, filters.employee_type]
  );

  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Payroll Dashboard</h1>
          <p className="meta">Live aggregation across employees, contracts, attendance, time off and payroll</p>
        </div>
      </div>

      <Card className="card" title="Filters">
        <div className="grid grid-4">
          <div className="field">
            <label>Period from</label>
            <input className="input" type="date" value={filters.period_start} onChange={set('period_start')} />
          </div>
          <div className="field">
            <label>Period to</label>
            <input className="input" type="date" value={filters.period_end} onChange={set('period_end')} />
          </div>
          <div className="field">
            <label>Department</label>
            <select className="select" value={filters.department_id} onChange={set('department_id')}>
              <option value="">All departments</option>
              {(departments.data || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Employee type</label>
            <select className="select" value={filters.employee_type} onChange={set('employee_type')}>
              <option value="">All types</option>
              <option value="full_time">Full time</option>
              <option value="part_time">Part time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </div>
        </div>
      </Card>

      <div style={{ height: 16 }} />

      <States loading={loading} error={error} onRetry={reload} empty={!data}>
        {data && (
          <>
            <div className="grid grid-4">
              <Kpi label="Total Net Paid" value={money(data.kpi.total_net)}
                   sub={`${data.kpi.payslip_count} payslips · ${data.kpi.paid_count} paid`} />
              <Kpi label="Average Salary" value={money(data.kpi.avg_salary)}
                   sub={`Gross ${money(data.kpi.total_gross)}`} />
              <Kpi label="Headcount" value={data.kpi.headcount}
                   sub={`${data.kpi.active_headcount} active`} />
              <Kpi label="Approved Time Off" value={`${data.kpi.approved_time_off} d`}
                   sub={`${data.kpi.pending_requests} pending approval`} />
              <Kpi label="Attendance Health" value={`${data.kpi.attendance_health}%`}
                   sub={`${data.attendance.records} records · ${data.attendance.late} late`} />
              <Kpi label="Missing Check-outs" value={data.attendance.missing_checkout}
                   sub={`${data.attendance.manual_edits} manual edits`} />
              <Kpi label="Overtime Entries" value={data.attendance.overtime}
                   sub={`Avg ${data.attendance.avg_hours} h/day`} />
              <Kpi label="Open Alerts" value={data.alerts.length}
                   sub={`${data.alerts.filter((a) => a.level === 'error').length} blocking`} />
            </div>

            <div style={{ height: 16 }} />

            <div className="grid grid-2">
              <Card title="Salary Cost by Department">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.by_department}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="department" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Bar dataKey="net" fill="#4f46e5" radius={[6, 6, 0, 0]} name="Net paid" />
                  </BarChart>
                </ResponsiveContainer>
              </Card>

              <Card title="Monthly Net Salary Trend">
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={data.trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Line type="monotone" dataKey="net" stroke="#4f46e5" strokeWidth={2} dot={{ r: 3 }} name="Net paid" />
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </div>

            <div style={{ height: 16 }} />

            <div className="grid grid-2">
              <Card title="Operational Alerts">
                {data.alerts.length === 0
                  ? <div className="state"><h3>All clear</h3><p className="muted">No payroll issues for these filters.</p></div>
                  : <div style={{ display: 'grid', gap: 8 }}>
                      {data.alerts.map((a, i) => {
                        const targetLink = resolveAlertLink(a);
                        return (
                          <div
                            key={i}
                            role={targetLink ? 'button' : undefined}
                            tabIndex={targetLink ? 0 : undefined}
                            onClick={() => targetLink && navigate(targetLink)}
                            onKeyDown={(e) => {
                              if (targetLink && (e.key === 'Enter' || e.key === ' ')) {
                                e.preventDefault();
                                navigate(targetLink);
                              }
                            }}
                            className={targetLink ? 'dashboard-alert-clickable' : ''}
                            style={{
                              cursor: targetLink ? 'pointer' : 'default',
                              outline: 'none',
                            }}
                          >
                            <Alert level={a.level}>
                              <span>{a.message}</span>
                              {targetLink && (
                                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 600, opacity: 0.85, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  → View
                                </span>
                              )}
                            </Alert>
                          </div>
                        );
                      })}
                    </div>}
              </Card>

              <Card title="Department Breakdown">
                <Table
                  columns={[
                    { key: 'department', label: 'Department' },
                    { key: 'headcount', label: 'Headcount', align: 'right' },
                    { key: 'net', label: 'Net paid', align: 'right', render: (r) => money(r.net) },
                  ]}
                  rows={data.by_department}
                  paginated={false}
                />
              </Card>
            </div>

            <div style={{ height: 16 }} />

            <div className="grid grid-2">
              <Card title="Attendance Overview">
                <Table
                  columns={[
                    { key: 'metric', label: 'Metric' },
                    { key: 'value', label: 'Value', align: 'right' },
                  ]}
                  rows={[
                    { id: 1, metric: 'Present',           value: data.attendance.present },
                    { id: 2, metric: 'Late',              value: data.attendance.late },
                    { id: 3, metric: 'Overtime',          value: data.attendance.overtime },
                    { id: 4, metric: 'Absent',            value: data.attendance.absent },
                    { id: 5, metric: 'Missing check-out', value: data.attendance.missing_checkout },
                    { id: 6, metric: 'Manual edits',      value: data.attendance.manual_edits },
                    { id: 7, metric: 'Average hours/day', value: data.attendance.avg_hours },
                  ]}
                  paginated={false}
                />
              </Card>

              <Card title="Time Off by Type">
                <Table
                  columns={[
                    { key: 'type', label: 'Type' },
                    { key: 'days', label: 'Approved days', align: 'right' },
                    { key: 'pending', label: 'Pending', align: 'right',
                      render: (r) => r.pending ? <Badge value="pending" /> : '—' },
                  ]}
                  rows={data.time_off.by_type}
                  paginated={false}
                />
              </Card>
            </div>
          </>
        )}
      </States>
    </>
  );
}
