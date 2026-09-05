/** Route guards. Nothing renders until we know who the caller is. */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext.jsx';

const ROLES = ['employee', 'hr_manager', 'payroll_user', 'payroll_manager', 'admin'];

function Booting() {
  return (
    <div className="state" style={{ paddingTop: 96 }}>
      <div className="skeleton" style={{ width: 220, height: 16, margin: '0 auto' }} />
    </div>
  );
}

/** Logged out -> /login, remembering where they were headed. */
export function RequireAuth({ children }) {
  const { user, booting } = useAuth();
  const location = useLocation();

  if (booting) return <Booting />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;

  // A forced password change blocks the rest of the app.
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

/** Wrong role -> an explicit refusal, never a blank screen. */
export function RequireRole({ module, children }) {
  const { user, permissions, booting } = useAuth();

  if (booting) return <Booting />;
  if (!user) return <Navigate to="/login" replace />;

  const need = permissions?.[module]?.read;
  const allowed = need && ROLES.indexOf(user.role) >= ROLES.indexOf(need);

  if (!allowed) {
    return (
      <div className="card card-pad-lg state">
        <h3>You don&apos;t have access to this area</h3>
        <p className="muted">
          Your role is <strong>{user.role.replace(/_/g, ' ')}</strong>, which cannot view{' '}
          <strong>{module}</strong>. Ask an administrator if you need access.
        </p>
      </div>
    );
  }
  return children;
}

/** Already logged in -> bounce away from /login and /signup. */
export function RedirectIfAuthed({ children }) {
  const { user, booting } = useAuth();
  if (booting) return <Booting />;
  if (user) return <Navigate to={user.must_change_password ? '/change-password' : '/dashboard'} replace />;
  return children;
}
