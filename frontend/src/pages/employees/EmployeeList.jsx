import { useMemo } from 'react';
import { Table, Badge } from '../../components/ui.jsx';

export default function EmployeeList({
  employees = [],
  onSelectEmployee,
  canDelete = false,
  onDeleteEmployee,
}) {
  const columns = useMemo(() => [
    {
      key: 'employee_number',
      label: 'Emp. No.',
      render: (emp) => <span className="mono">{emp.employee_number}</span>,
    },
    {
      key: 'name',
      label: 'Employee',
      render: (emp) => <span style={{ fontWeight: 600 }}>{emp.name}</span>,
    },
    {
      key: 'work_email',
      label: 'Work Email',
      render: (emp) => emp.work_email || '—',
    },
    {
      key: 'job_position_name',
      label: 'Job Position',
      render: (emp) => emp.job_position_name || '—',
    },
    {
      key: 'department_name',
      label: 'Department',
      render: (emp) => emp.department_name || '—',
    },
    {
      key: 'status',
      label: 'Status',
      render: (emp) => <Badge value={emp.status} />,
    },
    ...(canDelete
      ? [
          {
            key: 'actions',
            label: 'Actions',
            align: 'right',
            render: (emp) => (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                style={{ padding: '2px 8px', minHeight: 26, fontSize: 12 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteEmployee?.(emp);
                }}
              >
                Delete
              </button>
            ),
          },
        ]
      : []),
  ], [canDelete, onDeleteEmployee]);

  return (
    <div>
      <Table
        columns={columns}
        rows={employees}
        onRowClick={onSelectEmployee}
        empty="No employees match the current filters."
        pageSize={10}
      />
      <div className="meta" style={{ marginTop: 16 }}>
        Useful note: the list view is the main entry point for opening a specific employee record quickly.
      </div>
    </div>
  );
}
