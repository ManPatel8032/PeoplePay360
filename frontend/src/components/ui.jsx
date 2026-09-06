/**
 * Shared UI kit. Everyone builds pages out of these so the three tracks look
 * like one product. Add to this file rather than inventing local variants.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';

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

/** Declarative pagination controls with page size selector and page buttons. */
export function Pagination({
  currentPage = 1,
  totalItems = 0,
  pageSize = 10,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const start = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const end = Math.min(currentPage * pageSize, totalItems);

  const pages = useMemo(() => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const set = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
    const sorted = [...set].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
    const result = [];
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i] - sorted[i - 1] > 1) {
        result.push('...');
      }
      result.push(sorted[i]);
    }
    return result;
  }, [totalPages, currentPage]);

  if (totalItems === 0) return null;

  return (
    <div className="pagination-bar">
      <div className="pagination-info">
        Showing <strong>{start}–{end}</strong> of <strong>{totalItems}</strong> records
      </div>

      <div className="pagination-actions">
        {onPageSizeChange && (
          <div className="pagination-size">
            <span className="pagination-size-label">Rows per page:</span>
            <select
              className="pagination-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange?.(Number(e.target.value))}
              aria-label="Records per page"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="pagination-controls">
          <button
            type="button"
            className="btn btn-sm pagination-btn"
            disabled={currentPage <= 1}
            onClick={() => onPageChange?.(currentPage - 1)}
            aria-label="Previous page"
          >
            ‹ Prev
          </button>

          {pages.map((p, idx) =>
            p === '...' ? (
              <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                className={`btn btn-sm pagination-btn ${p === currentPage ? 'pagination-btn-active' : ''}`}
                onClick={() => onPageChange?.(p)}
                aria-current={p === currentPage ? 'page' : undefined}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            className="btn btn-sm pagination-btn"
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange?.(currentPage + 1)}
            aria-label="Next page"
          >
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}

/** Simple declarative table with built-in pagination. columns: [{key, label, render?, align?}] */
export function Table({
  columns,
  rows = [],
  onRowClick,
  empty = 'No records',
  pageSize: initialPageSize = 10,
  paginated = true,
  pageSizeOptions = [10, 25, 50, 100],
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const total = rows?.length || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Reset to page 1 if current page becomes invalid
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [totalPages, currentPage]);

  // Reset to page 1 when data length changes (e.g. search / filter changed)
  const prevTotalRef = useRef(total);
  useEffect(() => {
    if (prevTotalRef.current !== total) {
      prevTotalRef.current = total;
      setCurrentPage(1);
    }
  }, [total]);

  const pagedRows = useMemo(() => {
    if (!paginated) return rows || [];
    const start = (currentPage - 1) * pageSize;
    return (rows || []).slice(start, start + pageSize);
  }, [rows, paginated, currentPage, pageSize]);

  if (!rows?.length) return <div className="state"><h3>{empty}</h3></div>;

  return (
    <div className="table-container">
      <div className="table-wrap">
        <table>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} className={c.align === 'right' ? 'num' : ''}>{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {pagedRows.map((r, i) => (
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

      {paginated && (
        <Pagination
          currentPage={currentPage}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setCurrentPage}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setCurrentPage(1);
          }}
          pageSizeOptions={pageSizeOptions}
        />
      )}
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
      style={{
        position:   'fixed', inset: 0, background: 'rgb(15 23 42 / .45)', zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16
      }}
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

/**
 * Staff code column, shared by every table that lists employees so the format
 * and placement stay identical across the app.
 */
export const empNumberColumn = {
  key: 'employee_number',
  label: 'Emp. No.',
  render: (r) =>
    r.employee_number
      ? <span className="mono">{r.employee_number}</span>
      : <span className="muted">—</span>,
};

/**
 * Debounce function utility with cancel() and flush() methods.
 * Single reusable debounce implementation throughout the project.
 */
export function debounce(callback, delay = 300) {
  let timeoutId = null;
  let lastArgs = null;

  const debounced = (...args) => {
    lastArgs = args;
    clearTimeout(timeoutId);

    timeoutId = setTimeout(() => {
      callback(...args);
      timeoutId = null;
    }, delay);
  };

  debounced.cancel = () => {
    clearTimeout(timeoutId);
    timeoutId = null;
  };

  debounced.flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
      if (lastArgs) callback(...lastArgs);
    }
  };

  return debounced;
}

/**
 * Universal SearchInput with debounce, search icon,
 * and instant clear button.
 */
export function SearchInput({
  value: externalValue,
  onChange,
  onImmediateChange,
  placeholder = 'Search...',
  delay = 300,
  className = '',
  style = {},
  id,
  ...props
}) {
  const [internalValue, setInternalValue] = useState(externalValue ?? '');

  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const lastNotifiedRef = useRef(externalValue ?? '');
  const prevExternalValueRef = useRef(externalValue);

  // Stable debounced search function using the shared debounce() utility
  const debouncedSearch = useMemo(
    () =>
      debounce((value) => {
        lastNotifiedRef.current = value;
        onChangeRef.current?.(value);
      }, delay),
    [delay]
  );

  // Sync external value changes (e.g. Reset Filters button, programmatic reset)
  useEffect(() => {
    if (externalValue !== prevExternalValueRef.current) {
      prevExternalValueRef.current = externalValue;
      const normalized = externalValue ?? '';
      // Only sync if the change came from the outside, not from our own debounced notification
      if (normalized !== lastNotifiedRef.current) {
        debouncedSearch.cancel();
        setInternalValue(normalized);
        lastNotifiedRef.current = normalized;
      }
    }
  }, [externalValue, debouncedSearch]);

  // Cleanup debounce timer when component unmounts
  useEffect(() => {
    return () => {
      debouncedSearch.cancel();
    };
  }, [debouncedSearch]);

  const handleInputChange = (e) => {
    const val = e.target.value;

    setInternalValue(val);

    // Immediate callback — runs on every keystroke
    onImmediateChange?.(val);

    // Debounced callback — runs after user stops typing
    debouncedSearch(val);
  };

  const handleClear = () => {
    debouncedSearch.cancel();

    setInternalValue('');
    lastNotifiedRef.current = '';

    onImmediateChange?.('');
    onChangeRef.current?.('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      debouncedSearch.flush?.();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleClear();
    }
    props.onKeyDown?.(e);
  };

  return (
    <div
      className={`search-input-wrap ${className}`}
      style={style}
    >
      <svg
        className="search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <input
        type="text"
        id={id}
        className="input search-input"
        placeholder={placeholder}
        value={internalValue}
        onChange={handleInputChange}
        onKeyDown={handleKeyDown}
        autoComplete="off"
        {...props}
      />

      {Boolean(internalValue) && (
        <button
          type="button"
          className="search-clear-btn"
          onClick={handleClear}
          title="Clear search"
          aria-label="Clear search"
          tabIndex={-1}
        >
          ✕
        </button>
      )}
    </div>
  );
}



