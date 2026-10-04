/**
 * Local-calendar date helpers.
 *
 * Every "day" in PomoFocus is a local calendar date stored as a 'YYYY-MM-DD'
 * key. We never derive day keys through toISOString() (that is UTC and shifts
 * dates for anyone east or west of Greenwich). Arithmetic is done on Date
 * objects pinned to local NOON, so a 23- or 25-hour DST day can never push a
 * date across midnight.
 */

const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DAY_MS = 86400000;

export function pad2(n) { return String(n).padStart(2, '0'); }

/** Local date key for a Date (defaults to now). */
export function toKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayKey() { return toKey(new Date()); }

/** Local date key for an epoch-ms timestamp. */
export function keyFromTs(ms) { return toKey(new Date(ms)); }

export function isValidKey(key) {
  if (typeof key !== 'string') return false;
  const m = KEY_RE.exec(key);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo - 1);
}

/** Date object at local noon for a key. */
export function fromKey(key) {
  const m = KEY_RE.exec(key);
  if (!m) throw new Error(`Invalid date key: ${key}`);
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0, 0);
}

export function addDays(key, n) {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

export function addMonths(key, n) {
  const d = fromKey(key);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  d.setDate(Math.min(day, daysInMonth(d.getFullYear(), d.getMonth())));
  return toKey(d);
}

/** Whole days from a to b (b - a). DST-safe because both are at noon. */
export function diffDays(a, b) {
  return Math.round((fromKey(b) - fromKey(a)) / DAY_MS);
}

export function weekday(key) { return fromKey(key).getDay(); }

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function startOfWeek(key, weekStart = 1) {
  const wd = weekday(key);
  const back = (wd - weekStart + 7) % 7;
  return addDays(key, -back);
}

export function startOfMonth(key) { return key.slice(0, 8) + '01'; }
export function endOfMonth(key) {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth(), daysInMonth(d.getFullYear(), d.getMonth()), 12));
}
export function startOfYear(key) { return key.slice(0, 4) + '-01-01'; }
export function endOfYear(key) { return key.slice(0, 4) + '-12-31'; }

/** Inclusive list of keys from start to end. */
export function rangeKeys(start, end) {
  const out = [];
  if (!isValidKey(start) || !isValidKey(end) || start > end) return out;
  let k = start;
  let guard = 0;
  while (k <= end && guard++ < 4000) { out.push(k); k = addDays(k, 1); }
  return out;
}

/** 6x7 grid of keys covering a month, starting on weekStart. */
export function monthGrid(year, monthIndex, weekStart = 1) {
  const first = toKey(new Date(year, monthIndex, 1, 12));
  const start = startOfWeek(first, weekStart);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const fmtCache = new Map();
function fmt(opts) {
  const k = JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat(undefined, opts));
  return fmtCache.get(k);
}

export function formatKey(key, opts = { weekday: 'short', month: 'short', day: 'numeric' }) {
  if (!isValidKey(key)) return '—';
  return fmt(opts).format(fromKey(key));
}

export function formatLong(key) {
  return formatKey(key, { weekday: 'long', month: 'long', day: 'numeric' });
}

export function formatShort(key) {
  return formatKey(key, { month: 'short', day: 'numeric' });
}

export function formatMonth(year, monthIndex) {
  return fmt({ month: 'long', year: 'numeric' }).format(new Date(year, monthIndex, 1, 12));
}

export function weekdayNames(weekStart = 1, style = 'short') {
  // 2023-01-01 was a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    fmt({ weekday: style }).format(new Date(2023, 0, 1 + ((i + weekStart) % 7), 12)));
}

/** "Today", "Tomorrow", "Yesterday" or a short date. */
export function relativeLabel(key, today = todayKey()) {
  const d = diffDays(today, key);
  if (d === 0) return 'Today';
  if (d === 1) return 'Tomorrow';
  if (d === -1) return 'Yesterday';
  if (d > 1 && d < 7) return formatKey(key, { weekday: 'long' });
  const sameYear = key.slice(0, 4) === today.slice(0, 4);
  return formatKey(key, sameYear ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return 'Working late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** Minutes since local midnight for a timestamp. */
export function minuteOfDay(ms) {
  const d = new Date(ms);
  return d.getHours() * 60 + d.getMinutes();
}

/** Value for <input type="datetime-local"> from epoch ms, in local time. */
export function toLocalInputValue(ms) {
  const d = new Date(ms);
  return `${toKey(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function fromLocalInputValue(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Parses small natural-language dates used by quick add and the command
 * palette: today, tomorrow, yesterday, weekday names (next occurrence),
 * "oct 3", "3 oct", ISO keys, "+3" (days from today).
 * Returns a key or null.
 */
export function parseNaturalDate(input, today = todayKey()) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  if (isValidKey(s)) return s;
  if (s === 'today' || s === 'tod') return today;
  if (s === 'tomorrow' || s === 'tom' || s === 'tmr') return addDays(today, 1);
  if (s === 'yesterday') return addDays(today, -1);
  let m = /^\+(\d{1,3})d?$/.exec(s);
  if (m) return addDays(today, +m[1]);
  const wd = WEEKDAYS.findIndex((w) => s.startsWith(w));
  if (wd >= 0 && s.length <= 9) {
    let delta = (wd - weekday(today) + 7) % 7;
    if (delta === 0) delta = 7;
    return addDays(today, delta);
  }
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(s) || null;
  let mon, day, year;
  if (m) { mon = MONTHS.indexOf(m[1]); day = +m[2]; year = m[3] ? +m[3] : null; }
  else {
    m = /^(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/.exec(s);
    if (m) { mon = MONTHS.indexOf(m[2]); day = +m[1]; year = m[3] ? +m[3] : null; }
  }
  if (m && mon >= 0) {
    const ty = +today.slice(0, 4);
    const y = year || ty;
    const key = `${y}-${pad2(mon + 1)}-${pad2(day)}`;
    return isValidKey(key) ? key : null;
  }
  return null;
}
