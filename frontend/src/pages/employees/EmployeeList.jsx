import { Badge } from '../../components/ui.jsx';

export default function EmployeeList({
  employees,
  onSelectEmployee,
  canDelete = false,
  onDeleteEmployee,
}) {
  return (
    <div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Emp. No.</th>
              <th>Employee</th>
              <th>Work Email</th>
              <th>Job Position</th>
              <th>Department</th>
              <th>Status</th>
              {canDelete && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 ? (
              <tr>
                <td colSpan={canDelete ? 7 : 6} style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--text-muted)' }}>
                  No employees match the current filters.
                </td>
              </tr>
            ) : (
              employees.map((emp) => (
                <tr
                  key={emp.id}
                  className="clickable"
                  onClick={() => onSelectEmployee?.(emp)}
                >
                  <td><span className="mono">{emp.employee_number}</span></td>
                  <td style={{ fontWeight: 600 }}>{emp.name}</td>
                  <td>{emp.work_email || '—'}</td>
                  <td>{emp.job_position_name || '—'}</td>
                  <td>{emp.department_name || '—'}</td>
                  <td>
                    <Badge value={emp.status} />
                  </td>
                  {canDelete && (
                    <td style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn btn-sm btn-danger"
                        style={{ padding: '2px 8px', minHeight: 26, fontSize: 12 }}
                        onClick={() => onDeleteEmployee?.(emp)}
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="meta" style={{ marginTop: 16 }}>
        Useful note: the list view is the main entry point for opening a specific employee record quickly.
      </div>
    </div>
  );
}
