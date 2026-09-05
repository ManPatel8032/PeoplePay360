import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext.jsx';
import AuthLayout from './AuthLayout.jsx';
import PasswordStrength, { passwordProblems } from './PasswordStrength.jsx';

/**
 * Self-service signup for staff who already have an employee record.
 * The server only ever creates an `employee` role here — HR, payroll and admin
 * accounts are created by an administrator, never claimed from this screen.
 */
export default function SignupPage() {
  const { register } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  function validate() {
    const errs = {};
    if (!email.trim()) errs.email = 'Work email is required';
    else if (!/^\S+@\S+\.\S+$/.test(email.trim())) errs.email = 'Enter a valid email address';

    const problems = passwordProblems(password);
    if (!password) errs.password = 'Password is required';
    else if (problems.length) errs.password = problems[0];

    if (!confirm) errs.confirm = 'Confirm your password';
    else if (confirm !== password) errs.confirm = 'Passwords do not match';

    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      await register(email.trim(), password);
      setDone(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) return <Navigate to="/dashboard" replace />;

  return (
    <AuthLayout
      title="Create your account"
      subtitle="Use the work email your HR team already has on file."
      footer={<>Already have an account? <Link to="/login" className="auth-link">Sign in</Link></>}
    >
      <form onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert" style={{ marginBottom: 16, display: 'block' }}>
            {error}
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

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="password">Password</label>
          <div className="input-group">
            <input
              id="password"
              className="input"
              type={showPassword ? 'text' : 'password'}
              name="new-password"
              autoComplete="new-password"
              placeholder="At least 10 characters"
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
          <PasswordStrength value={password} />
          {fieldErrors.password && <span className="err">{fieldErrors.password}</span>}
        </div>

        <div className="field" style={{ marginBottom: 24 }}>
          <label htmlFor="confirm">Confirm password</label>
          <input
            id="confirm"
            className="input"
            type={showPassword ? 'text' : 'password'}
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!fieldErrors.confirm}
          />
          {fieldErrors.confirm && <span className="err">{fieldErrors.confirm}</span>}
        </div>

        <button className="btn btn-primary" type="submit" disabled={submitting} style={{ width: '100%', justifyContent: 'center' }}>
          {submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthLayout>
  );
}
