/** Display formatting. Pure functions, no DOM. */

/** Minutes → "3h 05m" / "45m" / "0m". */
export function fmtDuration(minutes, { compact = false } = {}) {
  const m = Math.max(0, Math.round(Number(minutes) || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  if (compact && r === 0) return `${h}h`;
  return `${h}h ${String(r).padStart(2, '0')}m`;
}

/** Seconds → "24:18" (or "1:04:18" past an hour). */
export function fmtClock(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function fmtTime(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function fmtDateTime(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtNumber(n, digits = 0) {
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
}

export function fmtPct(ratio, digits = 0) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** +2 / −1 / 0 with a real minus sign. */
export function fmtSigned(n, digits = 0) {
  if (!Number.isFinite(n)) return '—';
  const v = Number(n.toFixed(digits));
  if (v > 0) return `+${v}`;
  if (v < 0) return `\u2212${Math.abs(v)}`;
  return '0';
}

export function plural(n, one, many = `${one}s`) {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

export function fmtBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0; let v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : ''; }

export const PRIORITY_LABEL = { high: 'High', med: 'Medium', low: 'Low' };
