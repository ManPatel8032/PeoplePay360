import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, getUserId, setUserId } from './api.js';
import Dashboard from './pages/Dashboard.jsx';
import Placeholder from './pages/Placeholder.jsx';

const LINKS = [
  { to: '/dashboard',  label: 'Dashboard' },
  { to: '/employees',  label: 'Employees' },
  { to: '/contracts',  label: 'Contracts' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/time-off',   label: 'Time Off' },
  { to: '/payroll',    label: 'Payroll' },
  { to: '/config',     label: 'Configuration' },
];

/** Demo role switcher — proves the RBAC matrix without a login screen. */
function RoleSwitcher() {
  const [users, setUsers] = useState([]);
  const [current, setCurrent] = useState(getUserId());

  useEffect(() => { api.get('/users').then(setUsers).catch(() => {}); }, []);

  return (
    <select
      className="select"
      style={{ width: 'auto', minWidth: 190 }}
      value={current}
      onChange={(e) => { setUserId(e.target.value); setCurrent(e.target.value); window.location.reload(); }}
    >
      {users.map((u) => (
        <option key={u.id} value={u.id}>{u.name} · {u.role.replace(/_/g, ' ')}</option>
      ))}
    </select>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <nav className="nav">
          <div className="nav-inner">
            <div className="brand">PeoplePay<span>360</span></div>
            <div className="nav-links">
              {LINKS.map((l) => (
                <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  {l.label}
                </NavLink>
              ))}
            </div>
            <div className="nav-right"><RoleSwitcher /></div>
          </div>
        </nav>

        <main>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />

            {/* Section 1 — Identity, Access & Employee Master */}
            <Route path="/login" element={<Placeholder title="Login" owner="Section 1" />} />
            <Route path="/change-password" element={<Placeholder title="Change Password" owner="Section 1" />} />
            <Route path="/users/*" element={<Placeholder title="User Administration" owner="Section 1" />} />
            <Route path="/employees/*" element={<Placeholder title="Employees" owner="Section 1" />} />

            {/* Section 2 — Contracts, Time & Attendance */}
            <Route path="/contracts/*" element={<Placeholder title="Contracts" owner="Section 2" />} />
            <Route path="/attendance/*" element={<Placeholder title="Attendance" owner="Section 2" />} />
            <Route path="/schedules/*" element={<Placeholder title="Schedules" owner="Section 2" />} />
            <Route path="/time-off/*" element={<Placeholder title="Time Off" owner="Section 2" />} />

            {/* Section 3 — Payroll, Payslips & Reporting */}
            <Route path="/payroll/*" element={<Placeholder title="Payroll" owner="Section 3" />} />
            <Route path="/config/*" element={<Placeholder title="Configuration" owner="Section 3" />} />

            <Route path="*" element={<div className="state"><h3>Page not found</h3></div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
