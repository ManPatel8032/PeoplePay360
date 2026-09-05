import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import PasswordStrength, { passwordProblems } from './PasswordStrength.jsx';

/**
 * Reached two ways: voluntarily from the account menu, or forced when
 * `must_change_password` is set — which is how every seeded account starts.
 */
export default function ChangePasswordPage() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const forced = !!user?.must_change_password;

  function validate() {
    const errs = {};
    if (!currentPassword) errs.currentPassword = 'Current password is required';

    const problems = passwordProblems(newPassword);
    if (problems.length) errs.newPassword = problems[0];
    else if (newPassword === currentPassword) errs.newPassword = 'New password must differ from the current one';

    if (confirm !== newPassword) errs.confirm = 'Passwords do not match';

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return <Navigate to="/login" replace />;
  if (done) return <Navigate to="/dashboard" replace />;

  return (
    <AuthLayout
      title={forced ? 'Set a new password' : 'Change password'}
      subtitle={
        forced
          ? 'This account still uses its initial password. Choose a new one to continue.'
          : `Signed in as ${user.email}`
      }
      footer={
        forced
          ? <button className="auth-link" onClick={logout} style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>Sign out instead</button>
          : <button className="auth-link" onClick={() => navigate(-1)} style={{ background: 'none', border: 0, cursor: 'pointer', font: 'inherit' }}>Back</button>
      }
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 16, display: 'block' }}>
            {error}
          </div>
        )}

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="current">Current password</label>
          <input
            id="current"
            className="input"
            type="password"
            autoComplete="current-password"
            autoFocus
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            aria-invalid={!!fieldErrors.currentPassword}
          />
          {fieldErrors.currentPassword && <span className="err">{fieldErrors.currentPassword}</span>}
        </div>

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="new">New password</label>
          <input
            id="new"
            className="input"
            type="password"
            autoComplete="new-password"
            placeholder="At least 10 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={!!fieldErrors.newPassword}
          />
          <PasswordStrength value={newPassword} />
          {fieldErrors.newPassword && <span className="err">{fieldErrors.newPassword}</span>}
        </div>

        <div className="field" style={{ marginBottom: 24 }}>
          <label htmlFor="confirm">Confirm new password</label>
          <input
            id="confirm"
            className="input"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!fieldErrors.confirm}
          />
          {fieldErrors.confirm && <span className="err">{fieldErrors.confirm}</span>}
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
          {submitting ? 'Updating…' : 'Update password'}
        </button>
        <p className="meta" style={{ marginTop: 12, textAlign: 'center' }}>
          Your other sessions will be signed out.
        </p>
      </form>
    </AuthLayout>
  );
}
