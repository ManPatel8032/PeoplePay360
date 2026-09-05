import { useMemo } from 'react';
import { Badge } from '../../components/ui.jsx';

export default function EmployeeKanban({ employees, departments, onSelectEmployee }) {
  const grouped = useMemo(() => {
    const map = {};
    (departments || []).forEach((d) => {
      map[d.name] = [];
    });
    map['Unassigned'] = [];

    (employees || []).forEach((emp) => {
      const deptName = emp.department_name || 'Unassigned';
      if (!map[deptName]) map[deptName] = [];
      map[deptName].push(emp);
    });

    if (map['Unassigned'].length === 0) {
      delete map['Unassigned'];
    }

    return map;
  }, [employees, departments]);

  const columnNames = Object.keys(grouped);

  return (
    <div>
      <div className="kanban-board">
        {columnNames.map((dept) => {
          const list = grouped[dept];
          return (
            <div key={dept} className="kanban-col">
              <div className="kanban-col-head">
                <span>{dept}</span>
                <span className="badge">{list.length}</span>
              </div>

              {list.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)', fontSize: 13 }}>
                  No employees
                </div>
              ) : (
                list.map((emp) => {
                  const initials = emp.name
                    ? emp.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
                    : 'EM';
                  return (
                    <div
                      key={emp.id}
                      className="kanban-card"
                      onClick={() => onSelectEmployee?.(emp)}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>
                          {initials}
                        </div>
                        <div style={{ overflow: 'hidden' }}>
                          <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {emp.name}
                          </div>
                          <div className="meta" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {emp.job_position_name || 'No Position'}
                          </div>
                        </div>
                      </div>

                      <div className="meta" style={{ fontSize: 12, marginBottom: 8 }}>
                        {emp.work_email}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Badge value={emp.status} />
                        <span className="meta" style={{ textTransform: 'capitalize' }}>
                          {emp.employee_type?.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      <div className="meta" style={{ marginTop: 16 }}>
        Useful note: the list view is the main entry point for opening a specific employee record quickly.
      </div>
    </div>
  );
}
