/**
 * Password policy, shared by signup and change-password.
 * The server enforces the 10-character minimum; the extra checks here are
 * guidance, so the meter never claims a password is acceptable when it is not.
 */
export function passwordProblems(pw) {
  const problems = [];
  if (!pw) return ['Password is required'];
  if (pw.length < 10) problems.push('Password must be at least 10 characters');
  if (!/[a-z]/.test(pw)) problems.push('Add a lowercase letter');
  if (!/[A-Z]/.test(pw)) problems.push('Add an uppercase letter');
  if (!/[0-9]/.test(pw)) problems.push('Add a number');
  return problems;
}

const LEVELS = [
  { label: 'Too short', tone: 'var(--danger)' },
  { label: 'Weak', tone: 'var(--danger)' },
  { label: 'Fair', tone: 'var(--warning)' },
  { label: 'Good', tone: 'var(--info)' },
  { label: 'Strong', tone: 'var(--success)' },
];

function score(pw) {
  if (!pw || pw.length < 10) return 0;
  let s = 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/[0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 16) s++;
  return Math.min(s, 4);
}

export default function PasswordStrength({ value }) {
  if (!value) return null;
  const s = score(value);
  const level = LEVELS[s];

  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-bars">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{ background: i < s ? level.tone : 'var(--border)' }} />
        ))}
      </div>
      <span className="pw-label" style={{ color: level.tone }}>{level.label}</span>
    </div>
  );
}
