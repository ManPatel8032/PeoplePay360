/**
 * Shared UI kit. Everyone builds pages out of these so the three tracks look
 * like one product. Add to this file rather than inventing local variants.
 */
import { useEffect, useState, useCallback } from 'react';

/** Data-fetching hook that gives you all four states for free. */
export function useApi(fetcher, deps = []) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const reload = useCallback(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.resolve(fetcher())
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => reload(), [reload]);
  return { data, loading, error, reload, setData };
}

/** Renders loading / error / empty, or your children when there is data. */
export function States({ loading, error, empty, emptyText = 'Nothing here yet', children, onRetry }) {
  if (loading) return <Skeleton />;
  if (error) {
    return (
      <div className="state state-error">
        <h3>Something went wrong</h3>
        <p>{error.message}</p>
        {onRetry && <button className="btn" onClick={onRetry}>Retry</button>}
      </div>
    );
  }
  if (empty) return <div className="state"><h3>{emptyText}</h3><p className="muted">Create one to get started.</p></div>;
  return children;
}

export function Skeleton({ rows = 5 }) {
  return (
    <div className="card" style={{ display: 'grid', gap: 12 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${100 - i * 8}%` }} />
      ))}
    </div>
  );
}

export const Card = ({ title, action, children, className = '', pad = false }) => (
  <div className={`card ${pad ? 'card-pad-lg' : ''} ${className}`}>
    {(title || action) && (
      <div className="card-head">
        {title && <h3>{title}</h3>}
        {action}
      </div>
    )}
    {children}
  </div>
);

export const Kpi = ({ label, value, sub }) => (
  <div className="card kpi">
    <div className="kpi-label">{label}</div>
    <div className="kpi-value">{value}</div>
    {sub && <div className="kpi-sub">{sub}</div>}
  </div>
);

const TONE = {
  draft: '', to_approve: 'badge-warning', pending: 'badge-warning',
  computed: 'badge-info', validated: 'badge-accent', approved: 'badge-success',
  paid: 'badge-success', running: 'badge-success', active: 'badge-success',
  present: 'badge-success', overtime: 'badge-accent', late: 'badge-warning',
  half_day: 'badge-warning', on_leave: 'badge-warning', expired: '',
  refused: 'badge-danger', cancelled: 'badge-danger', absent: 'badge-danger', inactive: '',
};

export const Badge = ({ value, tone }) => (
  <span className={`badge ${tone ? `badge-${tone}` : TONE[value] || ''}`}>
    {String(value ?? '—').replace(/_/g, ' ')}
  </span>
);

/** Simple declarative table. columns: [{key, label, render?, align?}] */
export function Table({ columns, rows, onRowClick, empty = 'No records' }) {
  if (!rows?.length) return <div className="state"><h3>{empty}</h3></div>;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id ?? i} className={onRowClick ? 'clickable' : ''} onClick={() => onRowClick?.(r)}>
              {columns.map((c) => (
                <td key={c.key} className={c.align === 'right' ? 'num' : ''}>
                  {c.render ? c.render(r) : (r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export const Field = ({ label, error, children }) => (
  <div className="field">
    <label>{label}</label>
    {children}
    {error && <span className="err">{error}</span>}
  </div>
);

export const Alert = ({ level = 'info', children }) => (
  <div className={`alert alert-${level === 'error' ? 'error' : level === 'warning' ? 'warning' : 'info'}`}>
    {children}
  </div>
);

/** Full-screen on mobile, centred panel on desktop. */
export function Modal({ title, onClose, children, width = 560 }) {
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgb(15 23 42 / .45)', zIndex: 50,
               display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="card card-pad-lg"
        style={{ width: '100%', maxWidth: width, maxHeight: '90vh', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
      >
        <div className="card-head">
          <h2>{title}</h2>
          <button className="btn btn-sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}
