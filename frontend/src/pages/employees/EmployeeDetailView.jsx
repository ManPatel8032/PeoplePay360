import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, money } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { Card, Badge, States } from '../../components/ui.jsx';
import LeaveBalanceWidget from '../../components/LeaveBalanceWidget.jsx';

export default function EmployeeDetailView({ employeeId, initialEmployee, onClose, onEdit, isSelfView = false }) {
  const navigate = useNavigate();
  const { can } = useAuth();

  const [employee, setEmployee] = useState(initialEmployee || null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(!initialEmployee);
  const [error, setError] = useState(null);

  const canWriteEmployees = can('employees', 'write') !== 'none';
  const canReadContracts = can('contracts', 'read') !== 'none';
  const canReadAttendance = can('attendance', 'read') !== 'none';
  const canReadTimeOff = can('timeoff', 'read') !== 'none';
  const canReadPayslips = can('payslips', 'read') !== 'none';

  useEffect(() => {
    if (!employeeId) return;
    let alive = true;
    setLoading(true);

    Promise.all([
      api.get(`/employees/${employeeId}`).catch(() => {
        return api.get('/employees').then((list) => {
          const rows = Array.isArray(list) ? list : list?.data || [];
          return rows.find((r) => r.id === Number(employeeId));
        });
      }),
      api.get(`/employees/${employeeId}/summary`).catch(() => null),
    ])
      .then(([empData, sumData]) => {
        if (!alive) return;
        setEmployee(empData || initialEmployee);
        setSummary(sumData?.data || sumData || null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => { alive = false; };
  }, [employeeId, initialEmployee]);

  if (loading) {
    return (
      <div className="card card-pad-lg">
        <States loading={true} />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div className="card card-pad-lg state">
        <h3>Unable to load employee</h3>
        <p className="muted">{error?.message || 'Employee record not found'}</p>
        {onClose && (
          <button className="btn btn-sm" onClick={onClose} style={{ marginTop: 12 }}>
            Back to List
          </button>
        )}
      </div>
    );
  }

  const initials = employee.name
    ? employee.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
    : 'EM';

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Header bar */}
      <div className="card card-pad-lg">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div className="avatar" style={{ width: 48, height: 48, fontSize: 18 }}>
              {initials}
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h2>{employee.name}</h2>
                <Badge value={employee.status} />
              </div>
              <div className="meta" style={{ marginTop: 2 }}>
                {employee.job_position_name || 'No Position'} · {employee.department_name || 'No Department'} ·{' '}
                <span style={{ textTransform: 'capitalize' }}>{employee.employee_type?.replace(/_/g, ' ')}</span>
              </div>
            </div>
          </div>

          <div className="row">
            {canWriteEmployees && onEdit && (
              <button className="btn btn-primary" onClick={() => onEdit(employee)}>
                Edit Employee
              </button>
            )}
            {!isSelfView && onClose && (
              <button className="btn" onClick={onClose}>
                Back to List
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Smart Buttons */}
      <div className="row" style={{ gap: 12 }}>
        {canReadContracts && (
          <div
            className="smart-btn"
            onClick={() => navigate(`/contracts?employee_id=${employee.id}`)}
            title="View employee contracts"
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
              {summary?.contracts ?? '—'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Contracts</div>
              <div className="meta">View records</div>
            </div>
          </div>
        )}

        {canReadAttendance && (
          <div
            className="smart-btn"
            onClick={() => navigate(`/attendance?employee_id=${employee.id}`)}
            title="View attendance records"
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
              {summary?.attendance ?? '—'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Attendance</div>
              <div className="meta">Logged days</div>
            </div>
          </div>
        )}

        {canReadTimeOff && (
          <div
            className="smart-btn"
            onClick={() => navigate(`/time-off?employee_id=${employee.id}`)}
            title="View time off requests"
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
              {summary?.time_off ?? '—'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Time Off</div>
              <div className="meta">Requests</div>
            </div>
          </div>
        )}

        {canReadTimeOff && (
          <div
            className="smart-btn"
            onClick={() => navigate(`/time-off?employee_id=${employee.id}`)}
            title="View leave allocations"
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
              {summary?.allocations ?? '—'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Allocations</div>
              <div className="meta">Leave pools</div>
            </div>
          </div>
        )}

        {canReadPayslips && (
          <div
            className="smart-btn"
            onClick={() => navigate(`/payroll?employee_id=${employee.id}`)}
            title="View payslips"
          >
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--accent)' }}>
              {summary?.payslips ?? '—'}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Payslips</div>
              <div className="meta">History</div>
            </div>
          </div>
        )}
      </div>

      {/* Active Contract Alert */}
      {summary?.active_contract ? (
        <div className="card" style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent)' }}>
                Active Contract: {summary.active_contract.name}
              </div>
              <div className="meta" style={{ marginTop: 2 }}>
                Period: {summary.active_contract.start_date}
                {summary.active_contract.end_date ? ` to ${summary.active_contract.end_date}` : ' (Ongoing)'}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 20, fontWeight: 700 }}>
                {money(summary.active_contract.wage)}
              </div>
              <div className="meta">Monthly Wage</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ background: 'var(--surface-2)', border: '1px dashed var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--text-muted)' }}>
                No Active Contract
              </div>
              <div className="meta" style={{ marginTop: 2 }}>
                This employee has no running contract. A contract is required for payroll computation.
              </div>
            </div>
            {canReadContracts && (
              <button
                className="btn btn-sm btn-primary"
                onClick={() => navigate(`/contracts?employee_id=${employee.id}`)}
              >
                + Create Contract
              </button>
            )}
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-2">
        <Card title="Employment Details">
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 10, fontSize: 14 }}>
            <span className="muted">Department:</span>
            <span>{employee.department_name || '—'}</span>

            <span className="muted">Job Position:</span>
            <span>{employee.job_position_name || '—'}</span>

            <span className="muted">Manager:</span>
            <span>{employee.manager_name || '—'}</span>

            <span className="muted">Schedule:</span>
            <span>{employee.schedule_name || 'Standard'}</span>

            <span className="muted">Employee Type:</span>
            <span style={{ textTransform: 'capitalize' }}>{employee.employee_type?.replace(/_/g, ' ')}</span>

            <span className="muted">Join Date:</span>
            <span>{employee.join_date ? employee.join_date.slice(0, 10) : '—'}</span>
          </div>
        </Card>

        <Card title="Contact & Banking">
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 10, fontSize: 14 }}>
            <span className="muted">Work Email:</span>
            <span>{employee.work_email || '—'}</span>

            <span className="muted">Phone:</span>
            <span>{employee.phone || '—'}</span>

            <span className="muted">Bank Account:</span>
            <span>
              {employee.bank_account ? (
                <code>{employee.bank_account}</code>
              ) : (
                <span className="badge badge-warning">Missing (Warning)</span>
              )}
            </span>

            <span className="muted">Record ID:</span>
            <span>#{employee.id}</span>
          </div>
        </Card>
      </div>

      {/* Leave Balances Panel */}
      <Card
        title="Leave Balances"
        action={
          canReadTimeOff && (
            <button className="btn btn-sm" onClick={() => navigate(`/time-off?employee_id=${employee.id}`)}>
              Request Time Off
            </button>
          )
        }
      >
        <LeaveBalanceWidget employeeId={employee.id} />
      </Card>

      <div className="meta">
        Useful note: the list view is the main entry point for opening a specific employee record quickly.
      </div>
    </div>
  );
}
