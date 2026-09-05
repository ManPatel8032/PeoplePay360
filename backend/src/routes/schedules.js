/** Working schedules (A3). Owner: Track B / Section 2. */
import { Router } from 'express';
import { query, one, tx } from '../db.js';
import { can } from '../auth.js';
import { ah } from '../lib/crud.js';
import { weeklyHours } from '../lib/dates.js';

export const schedules = Router();

function validateScheduleLines(lines) {
  if (!Array.isArray(lines)) return null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const dow = Number(l.day_of_week);
    if (isNaN(dow) || dow < 0 || dow > 6) {
      return `Invalid day of week at row ${i + 1}`;
    }
    if (!l.start_time || !l.end_time) {
      return `Start time and end time required at row ${i + 1}`;
    }
    if (l.end_time <= l.start_time) {
      return `End time (${l.end_time}) must be after start time (${l.start_time}) at row ${i + 1}`;
    }
    if (l.break_minutes !== undefined && Number(l.break_minutes) < 0) {
      return `Break minutes cannot be negative at row ${i + 1}`;
    }
  }
  return null;
}

schedules.get('/', can('schedules', 'read'), ah(async (_req, res) => {
  const rows = await query('SELECT * FROM working_schedules ORDER BY name');
  const lines = await query('SELECT * FROM schedule_lines ORDER BY day_of_week, start_time');
  res.json({
    data: rows.map((s) => {
      const ls = lines.filter((l) => l.schedule_id === s.id);
      return { ...s, lines: ls, hours_per_week: Math.round(weeklyHours(ls) * 100) / 100, day_count: ls.length };
    }),
  });
}));

schedules.get('/:id', can('schedules', 'read'), ah(async (req, res) => {
  const s = await one('SELECT * FROM working_schedules WHERE id = $1', [req.params.id]);
  if (!s) return res.status(404).json({ error: 'Not found' });
  const lines = await query(
    'SELECT * FROM schedule_lines WHERE schedule_id = $1 ORDER BY day_of_week, start_time', [s.id]
  );
  res.json({ data: { ...s, lines, hours_per_week: Math.round(weeklyHours(lines) * 100) / 100, day_count: lines.length } });
}));

schedules.post('/', can('schedules', 'write'), ah(async (req, res) => {
  const { name, type = 'full_time', lines = [] } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Schedule name is required' });

  const lineErr = validateScheduleLines(lines);
  if (lineErr) return res.status(400).json({ error: lineErr });

  const id = await tx(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO working_schedules (name,type) VALUES ($1,$2) RETURNING id', [name.trim(), type]
    );
    await insertLines(c, rows[0].id, lines);
    return rows[0].id;
  });

  const fullLines = await query(
    'SELECT * FROM schedule_lines WHERE schedule_id = $1 ORDER BY day_of_week, start_time', [id]
  );
  const s = await one('SELECT * FROM working_schedules WHERE id = $1', [id]);
  res.status(201).json({ data: { ...s, lines: fullLines, hours_per_week: Math.round(weeklyHours(fullLines) * 100) / 100 } });
}));

schedules.patch('/:id', can('schedules', 'write'), ah(async (req, res) => {
  const existing = await one('SELECT * FROM working_schedules WHERE id = $1', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const { name, type, lines } = req.body;
  if (name !== undefined && (!name || !name.trim())) {
    return res.status(400).json({ error: 'Schedule name cannot be empty' });
  }

  if (Array.isArray(lines)) {
    const lineErr = validateScheduleLines(lines);
    if (lineErr) return res.status(400).json({ error: lineErr });
  }

  await tx(async (c) => {
    await c.query(
      'UPDATE working_schedules SET name = COALESCE($1,name), type = COALESCE($2,type) WHERE id = $3',
      [name?.trim() ?? null, type ?? null, req.params.id]
    );
    if (Array.isArray(lines)) {
      await c.query('DELETE FROM schedule_lines WHERE schedule_id = $1', [req.params.id]);
      await insertLines(c, req.params.id, lines);
    }
  });

  const fullLines = await query(
    'SELECT * FROM schedule_lines WHERE schedule_id = $1 ORDER BY day_of_week, start_time', [req.params.id]
  );
  const s = await one('SELECT * FROM working_schedules WHERE id = $1', [req.params.id]);
  res.json({ data: { ...s, lines: fullLines, hours_per_week: Math.round(weeklyHours(fullLines) * 100) / 100 } });
}));

schedules.delete('/:id', can('schedules', 'write'), ah(async (req, res) => {
  await query('DELETE FROM working_schedules WHERE id = $1', [req.params.id]);
  res.status(204).end();
}));

async function insertLines(client, scheduleId, lines) {
  for (const l of lines) {
    await client.query(
      `INSERT INTO schedule_lines (schedule_id,day_of_week,start_time,end_time,break_minutes)
       VALUES ($1,$2,$3,$4,$5)`,
      [scheduleId, l.day_of_week, l.start_time, l.end_time, Number(l.break_minutes) || 0]
    );
  }
}
