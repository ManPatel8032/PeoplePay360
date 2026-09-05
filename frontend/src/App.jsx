import { BrowserRouter, Routes, Route, NavLink, Navigate, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { RequireAuth, RequireRole, RedirectIfAuthed } from './auth/guards.jsx';

import LoginPage from './pages/auth/LoginPage.jsx';
import SignupPage from './pages/auth/SignupPage.jsx';
import ChangePasswordPage from './pages/auth/ChangePasswordPage.jsx';

import Dashboard from './pages/Dashboard.jsx';
import Placeholder from './pages/Placeholder.jsx';
import EmployeesPage from './pages/employees/EmployeesPage.jsx';
import UsersPage from './pages/users/UsersPage.jsx';
import PayrollIndex from './pages/payroll/PayrollIndex.jsx';
import ConfigIndex from './pages/config/ConfigIndex.jsx';
import ContractsPage from './pages/contracts/ContractsPage.jsx';
import AttendancePage from './pages/attendance/AttendancePage.jsx';
import SchedulesPage from './pages/schedules/SchedulesPage.jsx';
import TimeOffPage from './pages/timeoff/TimeOffPage.jsx';

/** `module` maps each destination to the permission matrix key that gates it. */
const LINKS = [
  { to: '/dashboard',  label: 'Dashboard',     module: 'dashboard' },
  { to: '/employees',  label: 'Employees',     module: 'employees' },
  { to: '/contracts',  label: 'Contracts',     module: 'contracts' },
  { to: '/attendance', label: 'Attendance',    module: 'attendance' },
  { to: '/time-off',   label: 'Time Off',      module: 'timeoff' },
  { to: '/schedules',  label: 'Schedules',     module: 'schedules' },
  { to: '/payroll',    label: 'Payroll',       module: 'payruns' },
  { to: '/config',     label: 'Configuration', module: 'structures' },
  { to: '/users',      label: 'Users',         module: 'users' },
];

const ROLE_LABEL = {
  employee: 'Employee',
  hr_manager: 'HR Manager',
  payroll_user: 'Payroll User',
  payroll_manager: 'Payroll Manager',
  admin: 'Admin',
};

function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onEsc);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onEsc); };
  }, []);

  if (!user) return null;
  const initials = user.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

  return (
    <div className="account" ref={ref}>
      <button className="account-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">{initials}</span>
        <span className="account-text">
          <span className="account-name">{user.name}</span>
          <span className="account-role">{ROLE_LABEL[user.role] || user.role}</span>
        </span>
      </button>

      {open && (
        <div className="account-menu" role="menu">
          <div className="account-menu-head">
            <div className="account-name">{user.name}</div>
            <div className="meta">{user.email}</div>
            <span className="badge badge-accent" style={{ marginTop: 8 }}>{ROLE_LABEL[user.role] || user.role}</span>
          </div>
          <button className="account-menu-item" role="menuitem" onClick={() => { setOpen(false); navigate('/change-password'); }}>
            Change password
          </button>
          <button className="account-menu-item danger" role="menuitem" onClick={async () => { setOpen(false); await logout(); navigate('/login', { replace: true }); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/** The chrome only renders for a signed-in user; logged-out screens are bare. */
function Shell({ children }) {
  const { user, canRead } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  if (!user) return <>{children}</>;

  const visible = LINKS.filter((l) => canRead(l.module));

  return (
    <div className="app">
      <nav className="nav">
        <div className="nav-inner">
          <div className="brand">PeoplePay<span>360</span></div>
          <div className="nav-links">
            {visible.map((l) => (
              <NavLink key={l.to} to={l.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <div className="nav-right">
            <button className="btn btn-sm nav-burger" onClick={() => setMobileOpen((o) => !o)} aria-label="Menu">Menu</button>
            <AccountMenu />
          </div>
        </div>
        {mobileOpen && (
          <div className="nav-drawer">
            {visible.map((l) => (
              <NavLink key={l.to} to={l.to} onClick={() => setMobileOpen(false)}
                className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>
      <main>{children}</main>
    </div>
  );
}

/** Smart redirect to dashboard or employees depending on user permissions */
function HomeRedirect() {
  const { canRead } = useAuth();
  return <Navigate to={canRead('dashboard') ? '/dashboard' : '/employees'} replace />;
}

/** Wraps a page in auth + role checks in one place. */
const Guarded = ({ module, children }) => (
  <RequireAuth><RequireRole module={module}>{children}</RequireRole></RequireAuth>
);

function AppRoutes() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />

        {/* Public */}
        <Route path="/login"  element={<RedirectIfAuthed><LoginPage /></RedirectIfAuthed>} />
        <Route path="/signup" element={<RedirectIfAuthed><SignupPage /></RedirectIfAuthed>} />
        <Route path="/change-password" element={<RequireAuth><ChangePasswordPage /></RequireAuth>} />

        <Route path="/dashboard" element={<Guarded module="dashboard"><Dashboard /></Guarded>} />

        {/* Section 1 — Identity, Access & Employee Master */}
        <Route path="/users/*"     element={<Guarded module="users"><UsersPage /></Guarded>} />
        <Route path="/employees/*" element={<Guarded module="employees"><EmployeesPage /></Guarded>} />

        {/* Section 2 — Contracts, Time & Attendance */}
        <Route path="/contracts/*"  element={<Guarded module="contracts"><ContractsPage /></Guarded>} />
        <Route path="/attendance/*" element={<Guarded module="attendance"><AttendancePage /></Guarded>} />
        <Route path="/schedules/*"  element={<Guarded module="schedules"><SchedulesPage /></Guarded>} />
        <Route path="/time-off/*"   element={<Guarded module="timeoff"><TimeOffPage /></Guarded>} />

        {/* Section 3 — Payroll, Payslips & Reporting */}
        <Route path="/payroll/*" element={<Guarded module="payruns"><PayrollIndex /></Guarded>} />
        <Route path="/config/*"  element={<Guarded module="structures"><ConfigIndex /></Guarded>} />

        <Route path="*" element={<div className="state"><h3>Page not found</h3></div>} />
      </Routes>
    </Shell>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
