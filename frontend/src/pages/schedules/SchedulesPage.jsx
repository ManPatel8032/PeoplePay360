import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useApi, States, Card, Table, Badge, Modal, Field, Alert, SearchInput } from '../../components/ui.jsx';


const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function calculateHoursForLine(start, end, breakMin = 0) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startDecimal = sh + sm / 60;
  const endDecimal = eh + em / 60;
  if (endDecimal <= startDecimal) return 0;
  return Math.max(0, endDecimal - startDecimal - (Number(breakMin) || 0) / 60);
}

function calculateTotalWeeklyHours(lines) {
  if (!Array.isArray(lines)) return 0;
  const total = lines.reduce(
    (sum, l) => sum + calculateHoursForLine(l.start_time, l.end_time, l.break_minutes),
    0
  );
  return Math.round(total * 100) / 100;
}

export default function SchedulesPage() {
  const { user, can } = useAuth();
  const canWrite = can('schedules', 'write') !== 'none';

  const navigate = useNavigate();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState(null);
  const [search, setSearch] = useState('');

  const { data: schedules, loading, error, reload } = useApi(() => api.get('/schedules'), []);

  const visibleSchedules = useMemo(() => {
    if (!schedules) return [];
    if (!search.trim()) return schedules;
    const q = search.trim().toLowerCase();
    return schedules.filter((s) =>
      s.name?.toLowerCase().includes(q) ||
      s.schedule_type?.toLowerCase().includes(q)
    );
  }, [schedules, search]);

  // Form state
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('full_time');
  const [formLines, setFormLines] = useState([]);


  // Compute live weekly hours as lines change
  const liveWeeklyHours = useMemo(() => calculateTotalWeeklyHours(formLines), [formLines]);

  // Check for any invalid line (end_time <= start_time)
  const lineErrors = useMemo(() => {
    return formLines.map((l) => {
      if (!l.start_time || !l.end_time) return null;
      if (l.end_time <= l.start_time) {
        return `End time (${l.end_time}) must be after start time (${l.start_time})`;
      }
      return null;
    });
  }, [formLines]);

  const hasLineErrors = lineErrors.some(Boolean);

  const openCreateModal = () => {
    setEditingSchedule(null);
    setFormName('');
    setFormType('full_time');
    // Default standard Mon-Fri schedule
    setFormLines([
      { day_of_week: 1, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
      { day_of_week: 2, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
      { day_of_week: 3, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
      { day_of_week: 4, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
      { day_of_week: 5, start_time: '09:00', end_time: '18:00', break_minutes: 60 },
    ]);
    setFormError(null);
    setModalOpen(true);
  };

  const openEditModal = (schedule) => {
    setEditingSchedule(schedule);
    setFormName(schedule.name || '');
    setFormType(schedule.type || 'full_time');
    setFormLines(
      (schedule.lines || []).map((l) => ({
        day_of_week: Number(l.day_of_week),
        start_time: l.start_time,
        end_time: l.end_time,
        break_minutes: Number(l.break_minutes || 0),
      }))
    );
    setFormError(null);
    setModalOpen(true);
  };

  const addLine = () => {
    // Next day not currently present, or Monday (1)
    const existingDows = new Set(formLines.map((l) => l.day_of_week));
    let nextDow = 1;
    for (let i = 1; i <= 6; i++) {
      if (!existingDows.has(i)) {
        nextDow = i;
        break;
      }
    }
    setFormLines([
      ...formLines,
      { day_of_week: nextDow, start_time: '09:00', end_time: '17:00', break_minutes: 60 },
    ]);
  };

  const removeLine = (index) => {
    setFormLines(formLines.filter((_, i) => i !== index));
  };

  const updateLine = (index, field, value) => {
    setFormLines(
      formLines.map((l, i) => {
        if (i !== index) return l;
        return { ...l, [field]: field === 'day_of_week' || field === 'break_minutes' ? Number(value) : value };
      })
    );
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setFormError(null);

    if (!formName.trim()) {
      setFormError('Schedule name is required.');
      return;
    }
    if (hasLineErrors) {
      setFormError('Please resolve schedule line errors before saving.');
      return;
    }

    setSaving(true);
    const payload = {
      name: formName.trim(),
      type: formType,
      lines: formLines,
    };

    try {
      if (editingSchedule) {
        await api.patch(`/schedules/${editingSchedule.id}`, payload);
      } else {
        await api.post('/schedules', payload);
      }
      setModalOpen(false);
      reload();
    } catch (err) {
      setFormError(err.message || 'Failed to save schedule');
    } finally {
      setSaving(false);
    }
  };

  const columns = useMemo(() => [
    {
      key: 'name',
      label: 'Schedule Name',
      render: (r) => <strong>{r.name}</strong>,
    },
    {
      key: 'type',
      label: 'Type',
      render: (r) => <Badge value={r.type} />,
    },
    {
      key: 'day_count',
      label: 'Working Days',
      render: (r) => `${r.day_count ?? (r.lines?.length || 0)} days / week`,
    },
    {
      key: 'hours_per_week',
      label: 'Weekly Hours (Derived)',
      align: 'right',
      render: (r) => (
        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>
          {r.hours_per_week ?? calculateTotalWeeklyHours(r.lines || [])} hrs
        </span>
      ),
    },
    {
      key: 'pattern',
      label: 'Working Days Pattern',
      render: (r) => {
        const dows = (r.lines || []).map((l) => DAY_NAMES[l.day_of_week]?.slice(0, 3)).join(', ');
        return <span className="meta">{dows || 'No days configured'}</span>;
      },
    },
  ], []);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Working Schedules</h1>
          <p className="meta">
            Weekly working hour templates — total weekly hours are derived dynamically from day rows, never typed
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => navigate('/contracts')}>
            Contracts ➔
          </button>
          {canWrite && (
            <button className="btn btn-primary" onClick={openCreateModal}>
              + New Schedule
            </button>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ maxWidth: 350 }}>
          <SearchInput
            placeholder="Search schedules by name..."
            value={search}
            onChange={setSearch}
          />
        </div>
      </div>

      <States loading={loading} error={error} empty={!visibleSchedules?.length} onRetry={reload}>
        <Card pad={false}>
          <Table columns={columns} rows={visibleSchedules} onRowClick={openEditModal} />
        </Card>
      </States>


      {/* Schedule Edit / Create Modal */}
      {modalOpen && (
        <Modal
          title={!canWrite ? `Schedule Details: ${editingSchedule?.name || ''}` : editingSchedule ? `Edit Schedule: ${editingSchedule.name}` : 'New Working Schedule'}
          onClose={() => setModalOpen(false)}
          width={700}
        >
          <form onSubmit={handleSave} style={{ display: 'grid', gap: 16 }}>
            <fieldset disabled={!canWrite} style={{ border: 'none', padding: 0, margin: 0, display: 'grid', gap: 16 }}>
            {formError && <Alert level="error">{formError}</Alert>}

            <div className="grid grid-2">
              <Field label="Schedule Name *">
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Standard 40h (Mon-Fri 9-6)"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                />
              </Field>

              <Field label="Schedule Type *">
                <select className="select" value={formType} onChange={(e) => setFormType(e.target.value)}>
                  <option value="full_time">Full Time</option>
                  <option value="part_time">Part Time</option>
                  <option value="flexible">Flexible</option>
                </select>
              </Field>
            </div>

            {/* Dynamic Weekly Hours Callout Banner */}
            <div
              className="card"
              style={{
                background: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  COMPUTED WEEKLY HOURS
                </span>
                <div className="meta" style={{ marginTop: 2 }}>
                  Dynamically derived from {formLines.length} day line(s) below minus break times
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)' }}>
                  {liveWeeklyHours}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, marginLeft: 4 }}>hrs / week</span>
              </div>
            </div>

            {/* Schedule Lines List */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>Daily Working Pattern</label>
                <button type="button" className="btn btn-sm" onClick={addLine}>
                  + Add Day Row
                </button>
              </div>

              {formLines.length === 0 ? (
                <div className="state" style={{ padding: '24px 0' }}>
                  <p>No working days configured. Click "+ Add Day Row" to add working days.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {formLines.map((line, idx) => {
                    const rowHours = calculateHoursForLine(line.start_time, line.end_time, line.break_minutes);
                    const errorMsg = lineErrors[idx];

                    return (
                      <div
                        key={idx}
                        className="card"
                        style={{
                          padding: '10px 14px',
                          borderColor: errorMsg ? 'var(--danger)' : 'var(--border)',
                          background: errorMsg ? '#fef2f2' : 'var(--surface)',
                        }}
                      >
                        <div style={{ display: 'grid', gridTemplateColumns: '150px 110px 110px 110px 80px 36px', gap: 8, alignItems: 'center' }}>
                          <div>
                            <select
                              className="select"
                              style={{ height: 34, minHeight: 34 }}
                              value={line.day_of_week}
                              onChange={(e) => updateLine(idx, 'day_of_week', e.target.value)}
                            >
                              {DAY_NAMES.map((d, i) => (
                                <option key={i} value={i}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <input
                              className="input"
                              type="time"
                              style={{ height: 34, minHeight: 34 }}
                              value={line.start_time}
                              onChange={(e) => updateLine(idx, 'start_time', e.target.value)}
                              required
                            />
                          </div>

                          <div>
                            <input
                              className="input"
                              type="time"
                              style={{ height: 34, minHeight: 34 }}
                              value={line.end_time}
                              onChange={(e) => updateLine(idx, 'end_time', e.target.value)}
                              required
                            />
                          </div>

                          <div>
                            <input
                              className="input"
                              type="number"
                              min="0"
                              step="5"
                              style={{ height: 34, minHeight: 34 }}
                              placeholder="Break (m)"
                              title="Break duration in minutes"
                              value={line.break_minutes}
                              onChange={(e) => updateLine(idx, 'break_minutes', e.target.value)}
                            />
                          </div>

                          <div style={{ textAlign: 'right', fontWeight: 600, fontSize: 13 }}>
                            {Math.round(rowHours * 100) / 100} h
                          </div>

                          <div>
                            <button
                              type="button"
                              className="btn btn-sm btn-danger"
                              style={{ padding: '2px 8px', minHeight: 28 }}
                              title="Remove day"
                              onClick={() => removeLine(idx)}
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {errorMsg && (
                          <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                            {errorMsg}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            </fieldset>

            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                {canWrite ? 'Cancel' : 'Close'}
              </button>
              {canWrite && (
                <button type="submit" className="btn btn-primary" disabled={saving || hasLineErrors}>
                  {saving ? 'Saving...' : editingSchedule ? 'Update Schedule' : 'Create Schedule'}
                </button>
              )}
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
