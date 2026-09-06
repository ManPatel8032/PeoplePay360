import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, SearchInput, Alert } from '../../components/ui.jsx';


import EmployeeList from './EmployeeList.jsx';
import EmployeeKanban from './EmployeeKanban.jsx';
import EmployeeDetailView from './EmployeeDetailView.jsx';
import EmployeeFormModal from './EmployeeFormModal.jsx';

export default function EmployeesPage() {
  const { user, can } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const missingBank = searchParams.get('missing_bank') === 'true';

  const [viewMode, setViewMode] = useState('list');
  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  const [selectedEmployee, setSelectedEmployee] = useState(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);

  const canReadScope = can('employees', 'read');
  const canWriteEmployees = can('employees', 'write') !== 'none';
  const canDeleteEmployees = can('employees', 'delete') !== 'none';
  const isEmployeeSelfScope = canReadScope === 'own';

  // Load reference departments
  const { data: departments } = useApi(() => api.get('/departments').catch(() => []), []);

  // Fetch employees
  const { data: employeesData, loading, error, reload } = useApi(
    () => api.get('/employees').catch(() => []),
    []
  );

  const rawEmployees = useMemo(() => {
    if (!employeesData) return [];
    return Array.isArray(employeesData) ? employeesData : employeesData.data || [];
  }, [employeesData]);

  // Client filtering
  const filteredEmployees = useMemo(() => {
    let result = rawEmployees;

    if (search?.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter(
        (e) =>
          e.name?.toLowerCase().includes(q) ||
          e.work_email?.toLowerCase().includes(q) ||
          e.job_position_name?.toLowerCase().includes(q) ||
          e.department_name?.toLowerCase().includes(q) ||
          e.employee_number?.toLowerCase().includes(q)
      );
    }


    if (departmentFilter) {
      result = result.filter((e) => String(e.department_id) === String(departmentFilter));
    }

    if (statusFilter) {
      result = result.filter((e) => e.status === statusFilter);
    }

    if (typeFilter) {
      result = result.filter((e) => e.employee_type === typeFilter);
    }

    if (missingBank) {
      result = result.filter((e) => !e.bank_account && e.status !== 'inactive');
    }

    return result;
  }, [rawEmployees, search, departmentFilter, statusFilter, typeFilter, missingBank]);

  // Employee self-view
  if (isEmployeeSelfScope) {
    const selfId = user?.employee_id || (rawEmployees[0]?.id);
    return (
      <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        <EmployeeDetailView
          employeeId={selfId}
          initialEmployee={rawEmployees.find((e) => e.id === selfId) || rawEmployees[0]}
          isSelfView={true}
        />
      </div>
    );
  }

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (emp) => {
    setEditingEmployee(emp);
    setIsFormOpen(true);
  };

  const handleSaved = () => {
    setIsFormOpen(false);
    setEditingEmployee(null);
    reload();
    if (selectedEmployee) {
      api.get(`/employees/${selectedEmployee.id}`).then((updated) => {
        setSelectedEmployee(updated);
      }).catch(() => {});
    }
  };

  const handleDeleteEmployee = async (emp) => {
    if (!confirm(`Permanently delete employee "${emp.name}" (${emp.employee_number || emp.id})? This will also remove their unfinalized contracts and attendance records. This cannot be undone.`)) {
      return;
    }
    try {
      await api.del(`/employees/${emp.id}`);
      if (selectedEmployee?.id === emp.id) {
        setSelectedEmployee(null);
      }
      reload();
    } catch (err) {
      alert(err.message || 'Failed to delete employee');
    }
  };

  return (
    <div>
      {selectedEmployee ? (
        <EmployeeDetailView
          employeeId={selectedEmployee.id}
          initialEmployee={selectedEmployee}
          onClose={() => setSelectedEmployee(null)}
          onEdit={handleOpenEdit}
          onDelete={handleDeleteEmployee}
        />
      ) : (
        <>
          <div className="page-head">
            <div>
              <h1>Employees</h1>
              <div className="meta" style={{ fontSize: 14, marginTop: 2 }}>
                List view for sort, filter and bulk scanning
              </div>
            </div>

            <div className="row">
              {canWriteEmployees && (
                <button
                  id="btn-new-employee"
                  className="btn btn-primary"
                  onClick={handleOpenCreate}
                >
                  + New Employee
                </button>
              )}
            </div>
          </div>

          {missingBank && (
            <div style={{ marginBottom: 16 }}>
              <Alert level="warning">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                  <span>Filtered by: <strong>Employees missing bank details</strong> ({filteredEmployees.length} found)</span>
                  <button
                    className="btn btn-sm"
                    onClick={() => {
                      const next = new URLSearchParams(searchParams);
                      next.delete('missing_bank');
                      setSearchParams(next);
                    }}
                  >
                    Clear Filter
                  </button>
                </div>
              </Alert>
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="row" style={{ flex: 1 }}>
                <SearchInput
                  id="search-employees"
                  placeholder="Search employees..."
                  value={search}
                  onChange={setSearch}
                  style={{ width: 250 }}
                />


                <select
                  className="select"
                  value={departmentFilter}
                  onChange={(e) => setDepartmentFilter(e.target.value)}
                  style={{ width: 170, minHeight: 34 }}
                >
                  <option value="">All Departments</option>
                  {(departments || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>

                <select
                  className="select"
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ width: 140, minHeight: 34 }}
                >
                  <option value="">All Statuses</option>
                  <option value="active">Active</option>
                  <option value="on_leave">On Leave</option>
                  <option value="inactive">Inactive</option>
                </select>

                <select
                  className="select"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  style={{ width: 140, minHeight: 34 }}
                >
                  <option value="">All Types</option>
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="contract">Contract</option>
                  <option value="intern">Intern</option>
                </select>
              </div>

              <div className="view-switch">
                <button
                  id="view-toggle-kanban"
                  className={`view-btn ${viewMode === 'kanban' ? 'active' : ''}`}
                  onClick={() => setViewMode('kanban')}
                >
                  Kanban
                </button>
                <button
                  id="view-toggle-list"
                  className={`view-btn ${viewMode === 'list' ? 'active' : ''}`}
                  onClick={() => setViewMode('list')}
                >
                  List
                </button>
              </div>
            </div>
          </div>

          <States
            loading={loading}
            error={error}
            empty={!loading && !error && filteredEmployees.length === 0 && !search && !departmentFilter}
            emptyText="No employees found"
            onRetry={reload}
          >
            {viewMode === 'list' ? (
              <EmployeeList
                employees={filteredEmployees}
                onSelectEmployee={(emp) => setSelectedEmployee(emp)}
                canDelete={canDeleteEmployees}
                onDeleteEmployee={handleDeleteEmployee}
              />
            ) : (
              <EmployeeKanban
                employees={filteredEmployees}
                departments={departments || []}
                onSelectEmployee={(emp) => setSelectedEmployee(emp)}
              />
            )}
          </States>
        </>
      )}

      {isFormOpen && (
        <EmployeeFormModal
          employee={editingEmployee}
          onClose={() => {
            setIsFormOpen(false);
            setEditingEmployee(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </div>
  );
}
