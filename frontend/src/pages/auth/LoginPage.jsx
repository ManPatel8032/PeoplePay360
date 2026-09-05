import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';

/** Server messages are already user-safe; this only adds guidance per status. */
function hintFor(status) {
  if (status === 423) return 'Too many failed attempts locked the account temporarily.';
  if (status === 429) return 'Slow down for a moment, then try again.';
  if (status === 403) return 'Contact an administrator to reactivate this account.';
  return null;
}

export default function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(null);

  function validate() {
    const errs = {};
    if (!email.trim()) errs.email = 'Email is required';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email address';
    if (!password) errs.password = 'Password is required';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      setDone('/');
    } catch (err) {
      setError({ message: err.message, hint: hintFor(err.status) });
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Navigate to={done} replace />;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="HR and payroll operations for your organisation."
      footer="Need an account? Contact your HR administrator."
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 16, display: 'block' }}>
            <strong>{error.message}</strong>
            {error.hint && <div style={{ marginTop: 4, fontWeight: 400 }}>{error.hint}</div>}
          </div>
        )}

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="email">Work email</label>
          <input
            id="email"
            className="input"
            type="email"
            name="email"
            autoComplete="email"
            autoFocus
            placeholder="you@peoplepay360.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
          />
          {fieldErrors.email && <span className="err">{fieldErrors.email}</span>}
        </div>

        <div className="field" style={{ marginBottom: 24 }}>
          <label htmlFor="password">Password</label>
          <div className="input-group">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-invalid={!!fieldErrors.password}
            />
            <button
              type="button"
              className="input-adornment"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {fieldErrors.password && <span className="err">{fieldErrors.password}</span>}
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
