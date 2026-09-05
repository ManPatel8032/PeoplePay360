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

            {/* Track A — owned by dev A */}
            <Route path="/employees/*"  element={<Placeholder title="Employees"  owner="Track A" />} />
            <Route path="/contracts/*"  element={<Placeholder title="Contracts"  owner="Track A" />} />

            {/* Track B — owned by dev B */}
            <Route path="/attendance/*" element={<Placeholder title="Attendance" owner="Track B" />} />
            <Route path="/time-off/*"   element={<Placeholder title="Time Off"   owner="Track B" />} />

            {/* Track C — owned by dev C */}
            <Route path="/payroll/*"    element={<Placeholder title="Payroll"    owner="Track C" />} />
            <Route path="/config/*"     element={<Placeholder title="Configuration" owner="Track C" />} />

            <Route path="*" element={<div className="state"><h3>Page not found</h3></div>} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
