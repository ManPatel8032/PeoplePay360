import { useState, useEffect } from 'react';
import { api } from '../api.js';

/**
 * Reusable Leave Balance Widget (Section 2 & reusable in Section 1 Employee form).
 * Fetches approved balances for all leave types for the given employeeId.
 */
export default function LeaveBalanceWidget({ employeeId, selectedTypeId, onSelectType }) {
  const [balances, setBalances] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!employeeId) {
      setBalances([]);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    api.get(`/time-off/requests/balances/${employeeId}`)
      .then((data) => {
        if (alive) setBalances(data || []);
      })
      .catch((err) => {
        if (alive) setError(err);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => { alive = false; };
  }, [employeeId]);

  if (!employeeId) return null;
  if (loading) {
    return (
      <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
        <span className="meta">Loading leave balances...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="card" style={{ padding: '12px 16px', background: '#fef2f2', borderColor: '#fecaca' }}>
        <span className="meta" style={{ color: 'var(--danger)' }}>Failed to load leave balances</span>
      </div>
    );
  }
  if (!balances.length) {
    return (
      <div className="card" style={{ padding: '12px 16px', background: 'var(--surface-2)' }}>
        <span className="meta">No leave types configured</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
      {balances.map((b) => {
        const isSelected = selectedTypeId && Number(selectedTypeId) === Number(b.type_id);
        const remaining = Number(b.remaining || 0);
        const allocated = Number(b.allocated || 0);
        const taken = Number(b.taken || 0);
        const isLow = b.requires_allocation && remaining <= 2;

        return (
          <div
            key={b.type_id}
            onClick={() => onSelectType?.(b.type_id)}
            className="card"
            style={{
              padding: '12px 14px',
              borderLeft: `4px solid ${b.color || 'var(--accent)'}`,
              cursor: onSelectType ? 'pointer' : 'default',
              background: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
              borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
              transition: 'all 0.15s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{b.type_name}</span>
              {!b.is_paid && (
                <span className="badge badge-warning" style={{ fontSize: 10, padding: '1px 5px' }}>
                  Unpaid (LOP)
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ fontSize: 22, fontWeight: 700, color: isLow ? 'var(--danger)' : 'var(--text)' }}>
                {b.requires_allocation ? remaining : '∞'}
              </span>
              <span className="meta" style={{ fontSize: 12 }}>
                {b.unit}(s) left
              </span>
            </div>

            {b.requires_allocation ? (
              <div className="meta" style={{ marginTop: 4, fontSize: 11 }}>
                <span>Allocated: {allocated}</span> · <span>Taken: {taken}</span>
              </div>
            ) : (
              <div className="meta" style={{ marginTop: 4, fontSize: 11 }}>
                <span>No allocation limit</span> · <span>Taken: {taken}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
