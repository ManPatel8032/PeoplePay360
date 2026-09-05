/**
 * Payroll landing page (Section 3) — tabs for Payruns and Payslips.
 * Clicking a payrun drills into PayrunDetail.
 */
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PayrunList from './PayrunList.jsx';
import PayrunDetail from './PayrunDetail.jsx';
import PayslipList from './PayslipList.jsx';

const TABS = [
  { key: 'payruns', label: 'Payruns' },
  { key: 'payslips', label: 'Payslips' },
];

export default function PayrollIndex() {
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = searchParams.get('tab');
  const [tab, setTab] = useState(urlTab === 'payslips' ? 'payslips' : 'payruns');
  const [selectedRun, setSelectedRun] = useState(null);

  useEffect(() => {
    if (urlTab === 'payslips' || urlTab === 'payruns') {
      setTab(urlTab);
    }
  }, [urlTab]);

  const handleTabChange = (key) => {
    setTab(key);
    const next = new URLSearchParams(searchParams);
    next.set('tab', key);
    setSearchParams(next);
  };

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
            onClick={() => handleTabChange(t.key)}
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
