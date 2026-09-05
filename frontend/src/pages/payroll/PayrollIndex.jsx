/**
 * Payroll landing page (Section 3) — tabs for Payruns and Payslips.
 * Clicking a payrun drills into PayrunDetail.
 */
import { useState } from 'react';
import PayrunList from './PayrunList.jsx';
import PayrunDetail from './PayrunDetail.jsx';
import PayslipList from './PayslipList.jsx';

const TABS = [
  { key: 'payruns', label: 'Payruns' },
  { key: 'payslips', label: 'Payslips' },
];

export default function PayrollIndex() {
  const [tab, setTab] = useState('payruns');
  const [selectedRun, setSelectedRun] = useState(null);

  if (selectedRun) {
    return (
      <PayrunDetail
        payrunId={selectedRun}
        onBack={() => setSelectedRun(null)}
      />
    );
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 16, gap: 4 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`btn btn-sm ${tab === t.key ? 'btn-primary' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'payruns' && <PayrunList onSelect={(r) => setSelectedRun(r.id)} />}
      {tab === 'payslips' && <PayslipList />}
    </>
  );
}
