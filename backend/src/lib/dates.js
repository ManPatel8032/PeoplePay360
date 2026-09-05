/** Date helpers. All dates are ISO 'YYYY-MM-DD' strings. */

export const iso = (d) => new Date(d).toISOString().slice(0, 10);

export function eachDay(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const daysBetween = (from, to) => eachDay(from, to).length;

export function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * How many months a date range is worth, counted month by month.
 *
 * A monthly wage buys a month, so a period must be divided by the length of the
 * month each of its days belongs to. Dividing the whole span by one month's
 * length — the month the period happens to start in — overpays whenever the
 * period crosses into a longer or shorter month.
 */
export function monthFraction(from, to) {
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    const d = new Date(cursor + 'T00:00:00Z');
    const { start, end } = monthBounds(d.getUTCFullYear(), d.getUTCMonth() + 1);
    const sliceEnd = end < to ? end : to;
    total += daysBetween(cursor, sliceEnd) / daysBetween(start, end);
    cursor = addDays(sliceEnd, 1);
  }
  return total;
}

/** Overlap of two closed date ranges, in days. b_end may be null (open ended). */
export function overlapDays(aStart, aEnd, bStart, bEnd) {
  const s = aStart > bStart ? aStart : bStart;
  const e = !bEnd ? aEnd : (aEnd < bEnd ? aEnd : bEnd);
  if (s > e) return 0;
  return daysBetween(s, e);
}

export function monthBounds(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const HHMM = (t) => {
  const [h, m] = t.split(':').map(Number);
  return h + m / 60;
};

/** Weekly hours derived from schedule lines, never stored (A3). */
export function weeklyHours(lines) {
  return lines.reduce(
    (sum, l) => sum + Math.max(0, HHMM(l.end_time) - HHMM(l.start_time) - (l.break_minutes || 0) / 60),
    0
  );
}

/** Scheduled hours for each weekday of a pattern, keyed by day_of_week. */
export function hoursByDayOfWeek(lines) {
  const map = new Map();
  for (const l of lines) {
    const hours = Math.max(0, HHMM(l.end_time) - HHMM(l.start_time) - (l.break_minutes || 0) / 60);
    map.set(l.day_of_week, (map.get(l.day_of_week) || 0) + hours);
  }
  return map;
}

/** Number of scheduled working days in [from,to] for a weekly pattern. */
export function scheduledDays(lines, from, to) {
  if (!lines.length) return 0;
  const workDows = new Set(lines.map((l) => l.day_of_week));
  return eachDay(from, to).filter((d) => workDows.has(new Date(d + 'T00:00:00Z').getUTCDay())).length;
}

export const hoursBetween = (a, b) =>
  a && b ? Math.max(0, (new Date(b) - new Date(a)) / 3600000) : 0;
