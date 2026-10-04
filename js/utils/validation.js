/**
 * Validation & normalization.
 *
 * Every record entering storage — from a form, an import or the legacy
 * migration — passes through a normalizer here. Normalizers coerce harmless
 * variations (numeric strings, missing optional fields) and throw
 * ValidationError for things that would corrupt data (NaN, empty titles,
 * invalid dates). Nothing invalid reaches IndexedDB.
 */
import { isValidKey } from './dates.js';
import {
  PRIORITIES, TASK_STATUS, TASK_KIND, OBJECTIVE_STATUS, SESSION_TYPES, STREAK_METRICS,
  RECURRENCE_FREQ, DATA_COLLECTIONS,
} from '../core/constants.js';

export class ValidationError extends Error {
  constructor(message, field) { super(message); this.name = 'ValidationError'; this.field = field; }
}

// ---------- primitives ----------
export function text(v, { max = 500, required = false, field = 'value', trim = true } = {}) {
  let s = v == null ? '' : String(v);
  if (trim) s = s.trim();
  if (required && !s) throw new ValidationError(`${field} is required`, field);
  return s.slice(0, max);
}

export function int(v, { min = 0, max = 100000, fallback = null, field = 'value', required = false } = {}) {
  if (v === '' || v == null) {
    if (required) throw new ValidationError(`${field} is required`, field);
    return fallback;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`${field} must be a number`, field);
  const r = Math.round(n);
  if (r < min || r > max) throw new ValidationError(`${field} must be between ${min} and ${max}`, field);
  return r;
}

export function num(v, { min = 0, max = 1e12, fallback = null, field = 'value' } = {}) {
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${field} is out of range`, field);
  return n;
}

export function bool(v) { return v === true || v === 'true' || v === 1 || v === 'on'; }

export function dateKey(v, { field = 'date', required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw new ValidationError(`${field} is required`, field);
    return null;
  }
  if (!isValidKey(v)) throw new ValidationError(`${field} is not a valid date`, field);
  return v;
}

export function ts(v, { field = 'timestamp', required = false } = {}) {
  if (v == null || v === '') {
    if (required) throw new ValidationError(`${field} is required`, field);
    return null;
  }
  const n = typeof v === 'string' && !/^\d+$/.test(v) ? Date.parse(v) : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 8.64e15) throw new ValidationError(`${field} is not a valid time`, field);
  return Math.round(n);
}

export function oneOf(v, options, fallback) { return options.includes(v) ? v : fallback; }

export function idList(v) {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x) => typeof x === 'string' && x))];
}

export function color(v, fallback = '#64748b') {
  return typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
}

function id(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError('id is missing', 'id');
  return v.trim().slice(0, 120);
}

function stamps(r, now) {
  const createdAt = ts(r.createdAt) ?? now;
  return { createdAt, updatedAt: ts(r.updatedAt) ?? createdAt };
}

// ---------- entities ----------
export function normalizeProject(r, now = Date.now()) {
  return {
    id: id(r.id),
    name: text(r.name, { max: 80, required: true, field: 'Project name' }),
    color: color(r.color),
    description: text(r.description, { max: 1000 }),
    archived: bool(r.archived),
    order: num(r.order, { min: -1e12 }) ?? 0,
    ...stamps(r, now),
  };
}

export function normalizeRecurrence(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const freq = oneOf(rec.freq, RECURRENCE_FREQ, null);
  if (!freq) return null;
  const days = Array.isArray(rec.days) ? [...new Set(rec.days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [];
  if (freq === 'weekly' && !days.length) throw new ValidationError('Pick at least one weekday for a weekly repeat', 'recurrence');
  return {
    freq,
    days: freq === 'weekly' ? days : [],
    interval: freq === 'interval' ? int(rec.interval, { min: 1, max: 365, fallback: 2, field: 'Repeat interval' }) : 1,
    startDate: dateKey(rec.startDate),
  };
}

export function normalizeTask(r, now = Date.now()) {
  const kind = oneOf(r.kind, Object.values(TASK_KIND), TASK_KIND.SINGLE);
  const statuses = kind === TASK_KIND.SERIES ? ['active', 'archived'] : ['inbox', 'planned', 'in-progress', 'completed', 'archived'];
  const plannedDate = kind === TASK_KIND.SERIES ? null : dateKey(r.plannedDate, { field: 'Planned date' });
  let status = oneOf(r.status, statuses, null);
  if (!status) status = kind === TASK_KIND.SERIES ? 'active' : (plannedDate ? TASK_STATUS.PLANNED : TASK_STATUS.INBOX);
  const estimate = int(r.estimate, { min: 0, max: 999, fallback: null, field: 'Pomodoro estimate' });
  const recurrence = kind === TASK_KIND.SERIES ? normalizeRecurrence(r.recurrence) : null;
  if (kind === TASK_KIND.SERIES && !recurrence) throw new ValidationError('A recurring task needs a repeat rule', 'recurrence');
  const out = {
    id: id(r.id),
    kind,
    seriesId: kind === TASK_KIND.OCCURRENCE ? (r.seriesId ? String(r.seriesId) : null) : null,
    occurrenceDate: kind === TASK_KIND.OCCURRENCE ? (dateKey(r.occurrenceDate) ?? plannedDate) : null,
    title: text(r.title, { max: 300, required: true, field: 'Task title' }),
    notes: text(r.notes, { max: 10000, trim: false }),
    priority: oneOf(r.priority, PRIORITIES, 'low'),
    status,
    projectId: r.projectId ? String(r.projectId) : null,
    objectiveId: r.objectiveId ? String(r.objectiveId) : null,
    tags: Array.isArray(r.tags) ? [...new Set(r.tags.map((t) => text(t, { max: 40 }).toLowerCase()).filter(Boolean))].slice(0, 20) : [],
    estimate,
    originalEstimate: int(r.originalEstimate, { min: 0, max: 999, fallback: estimate }),
    estimateHistory: Array.isArray(r.estimateHistory)
      ? r.estimateHistory.filter((e) => e && Number.isFinite(Number(e.value)) && Number(e.value) >= 0)
        .map((e) => ({ value: Math.round(Number(e.value)), at: ts(e.at) ?? null, ...(e.source ? { source: String(e.source) } : {}) }))
      : [],
    plannedDate,
    dueDate: dateKey(r.dueDate, { field: 'Due date' }),
    moveHistory: Array.isArray(r.moveHistory)
      ? r.moveHistory.filter((m) => m && (m.from === null || isValidKey(m.from)) && (m.to === null || isValidKey(m.to)))
        .map((m) => ({ from: m.from ?? null, to: m.to ?? null, at: ts(m.at) ?? null }))
      : [],
    recurrence,
    skippedDates: kind === TASK_KIND.SERIES ? (Array.isArray(r.skippedDates) ? r.skippedDates.filter(isValidKey) : []) : [],
    dependsOn: idList(r.dependsOn).filter((d) => d !== r.id),
    order: num(r.order, { min: -1e15, max: 1e15 }) ?? now,
    startedAt: ts(r.startedAt),
    completedAt: ts(r.completedAt),
    completedDate: dateKey(r.completedDate),
    archivedAt: ts(r.archivedAt),
    estimateReliable: r.estimateReliable === false ? false : true,
    ...stamps(r, now),
  };
  if (out.status !== 'completed' && out.status !== 'archived') { out.completedAt = null; out.completedDate = null; }
  if (r.legacy && typeof r.legacy === 'object') out.legacy = sanitizePlain(r.legacy);
  if (r.estimateNote) out.estimateNote = text(r.estimateNote, { max: 300 });
  return out;
}

export function normalizeObjective(r, now = Date.now()) {
  const status = oneOf(r.status, OBJECTIVE_STATUS, 'active');
  return {
    id: id(r.id),
    title: text(r.title, { max: 200, required: true, field: 'Objective title' }),
    description: text(r.description, { max: 4000, trim: false }),
    notes: text(r.notes, { max: 10000, trim: false }),
    projectId: r.projectId ? String(r.projectId) : null,
    status,
    priority: oneOf(r.priority, PRIORITIES, 'med'),
    startDate: dateKey(r.startDate, { field: 'Start date' }),
    targetDate: dateKey(r.targetDate, { field: 'Target date' }),
    completionRule: oneOf(r.completionRule, ['manual', 'all-tasks'], 'manual'),
    order: num(r.order, { min: -1e15, max: 1e15 }) ?? now,
    completedAt: status === 'completed' ? ts(r.completedAt) : null,
    completedDate: status === 'completed' ? dateKey(r.completedDate) : null,
    ...stamps(r, now),
  };
}

export function normalizePlan(r, now = Date.now()) {
  const date = dateKey(r.date ?? r.id, { required: true, field: 'Plan date' });
  return {
    id: date,
    date,
    objectiveIds: idList(r.objectiveIds),
    habitIds: Array.isArray(r.habitIds) ? idList(r.habitIds) : null,
    dayWinTaskId: r.dayWinTaskId ? String(r.dayWinTaskId) : null,
    dayWinHistory: Array.isArray(r.dayWinHistory) ? r.dayWinHistory.slice(-50).map(sanitizePlain) : [],
    focusTargetMin: int(r.focusTargetMin, { min: 0, max: 1440, fallback: null, field: 'Focus target' }),
    intention: text(r.intention, { max: 2000, trim: false }),
    saved: bool(r.saved),
    savedAt: ts(r.savedAt),
    snapshot: r.snapshot && typeof r.snapshot === 'object' ? sanitizePlain(r.snapshot) : null,
    ...stamps(r, now),
  };
}

export function normalizeHabit(r, now = Date.now()) {
  const type = oneOf(r.schedule?.type, ['daily', 'days'], 'daily');
  const days = type === 'days'
    ? [...new Set((r.schedule?.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort()
    : [];
  if (type === 'days' && !days.length) throw new ValidationError('Pick at least one day for this habit', 'schedule');
  return {
    id: id(r.id),
    name: text(r.name, { max: 120, required: true, field: 'Habit name' }),
    description: text(r.description, { max: 2000, trim: false }),
    schedule: { type, days },
    target: text(r.target, { max: 120 }),
    estimateMin: int(r.estimateMin, { min: 0, max: 1440, fallback: null, field: 'Time estimate' }),
    projectId: r.projectId ? String(r.projectId) : null,
    active: r.active === undefined ? true : bool(r.active),
    startDate: dateKey(r.startDate),
    order: num(r.order, { min: -1e15, max: 1e15 }) ?? now,
    ...stamps(r, now),
  };
}

export function normalizeHabitCompletion(r, now = Date.now()) {
  const habitId = text(r.habitId, { required: true, field: 'habitId' });
  const date = dateKey(r.date, { required: true });
  return {
    id: `${habitId}@${date}`,
    habitId,
    date,
    completedAt: ts(r.completedAt) ?? now,
    note: text(r.note, { max: 500 }),
    ...stamps(r, now),
  };
}

export function normalizeSession(r, now = Date.now()) {
  const type = oneOf(r.type, SESSION_TYPES, null);
  if (!type) throw new ValidationError('Unknown session type', 'type');
  const source = oneOf(r.source, ['timer', 'manual', 'legacy'], 'manual');
  const startTime = ts(r.startTime);
  const endTime = ts(r.endTime);
  if (startTime && endTime && endTime < startTime) throw new ValidationError('Session ends before it starts', 'endTime');
  const actualDuration = num(r.actualDuration, { min: 0, max: 86400, fallback: null, field: 'Duration' });
  return {
    id: id(r.id),
    type,
    taskId: r.taskId ? String(r.taskId) : null,
    objectiveId: r.objectiveId ? String(r.objectiveId) : null,
    projectId: r.projectId ? String(r.projectId) : null,
    date: dateKey(r.date, { required: true, field: 'Session date' }),
    startTime,
    endTime,
    plannedDuration: num(r.plannedDuration, { min: 0, max: 86400, fallback: null }),
    actualDuration: actualDuration == null ? null : Math.round(actualDuration),
    completed: r.completed === undefined ? true : bool(r.completed),
    source,
    durationSource: text(r.durationSource, { max: 40 }) || (source === 'legacy' ? 'legacy' : 'measured'),
    notes: text(r.notes, { max: 2000, trim: false }),
    ...(r.legacyRef ? { legacyRef: sanitizePlain(r.legacyRef) } : {}),
    ...stamps(r, now),
  };
}

export function normalizeStreak(r, now = Date.now()) {
  const metric = oneOf(r.metric, Object.keys(STREAK_METRICS), null);
  if (!metric) throw new ValidationError('Choose what the streak measures', 'metric');
  const spec = STREAK_METRICS[metric];
  const habitIds = idList(r.habitIds);
  if (spec.needsHabits && !habitIds.length) throw new ValidationError('Choose at least one habit for this streak', 'habitIds');
  const activeDays = Array.isArray(r.activeDays) && r.activeDays.length
    ? [...new Set(r.activeDays.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : [0, 1, 2, 3, 4, 5, 6];
  return {
    id: id(r.id),
    name: text(r.name, { max: 80, required: true, field: 'Streak name' }),
    metric,
    threshold: spec.needsThreshold ? int(r.threshold, { min: 1, max: 100000, required: true, field: 'Threshold' }) : null,
    habitIds: spec.needsHabits === 'one' ? habitIds.slice(0, 1) : habitIds,
    frequency: oneOf(r.frequency, ['daily', 'weekly'], 'daily'),
    activeDays,
    enabled: r.enabled === undefined ? true : bool(r.enabled),
    order: num(r.order, { min: -1e15, max: 1e15 }) ?? now,
    ...stamps(r, now),
  };
}

export function normalizeReview(r, now = Date.now()) {
  const date = dateKey(r.date ?? r.id, { required: true, field: 'Review date' });
  return {
    id: date,
    date,
    wentWell: text(r.wentWell, { max: 10000, trim: false }),
    change: text(r.change, { max: 10000, trim: false }),
    notes: text(r.notes, { max: 10000, trim: false }),
    ...stamps(r, now),
  };
}

export function normalizeActivity(r, now = Date.now()) {
  const at = ts(r.ts, { required: true, field: 'Activity time' });
  return {
    id: id(r.id),
    type: text(r.type, { max: 40, required: true, field: 'Activity type' }),
    ts: at,
    date: dateKey(r.date, { required: true }),
    taskId: r.taskId ? String(r.taskId) : null,
    title: text(r.title, { max: 300 }),
    projectId: r.projectId ? String(r.projectId) : null,
    source: text(r.source, { max: 20 }) || 'app',
    countsAsCompletion: r.countsAsCompletion === undefined ? true : bool(r.countsAsCompletion),
    note: text(r.note, { max: 300 }),
    ...stamps(r, now),
  };
}

export const NORMALIZERS = {
  projects: normalizeProject,
  objectives: normalizeObjective,
  tasks: normalizeTask,
  dailyPlans: normalizePlan,
  habits: normalizeHabit,
  habitCompletions: normalizeHabitCompletion,
  sessions: normalizeSession,
  streaks: normalizeStreak,
  reviews: normalizeReview,
  activity: normalizeActivity,
};

/** Strip functions / prototypes / cycles from free-form legacy blobs. */
function sanitizePlain(v) {
  try { return JSON.parse(JSON.stringify(v)); } catch { return null; }
}

/**
 * Validate a whole dataset (new-format backup or migrated legacy data).
 * Invalid records are skipped and reported; duplicate IDs keep the last
 * occurrence; dangling references are cleared and reported. Returns a clean
 * dataset that is safe to write.
 */
export function validateDataset(raw) {
  const warnings = [];
  const errors = [];
  const data = {};
  const now = Date.now();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { data: null, warnings, errors: ['The file does not contain a Winlark data object.'] };
  }
  for (const name of DATA_COLLECTIONS) {
    const list = raw[name];
    if (list == null) { data[name] = []; continue; }
    if (!Array.isArray(list)) { errors.push(`"${name}" should be a list.`); data[name] = []; continue; }
    const byId = new Map();
    let invalid = 0; let dup = 0;
    const samples = [];
    for (const rec of list) {
      try {
        const clean = NORMALIZERS[name](rec || {}, now);
        if (byId.has(clean.id)) dup++;
        byId.set(clean.id, clean);
      } catch (err) {
        invalid++;
        if (samples.length < 3) samples.push(err.message);
      }
    }
    if (invalid) warnings.push(`${invalid} ${name} record(s) were invalid and skipped (${samples.join('; ')}).`);
    if (dup) warnings.push(`${dup} duplicate ${name} ID(s) — kept the last copy of each.`);
    data[name] = [...byId.values()];
  }
  data.settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : null;

  // Referential integrity
  const ids = (n) => new Set(data[n].map((r) => r.id));
  const projectIds = ids('projects');
  const objectiveIds = ids('objectives');
  const taskIds = ids('tasks');
  const habitIds = ids('habits');
  let fixes = { project: 0, objective: 0, task: 0, habit: 0, series: 0 };
  for (const t of data.tasks) {
    if (t.projectId && !projectIds.has(t.projectId)) { t.projectId = null; fixes.project++; }
    if (t.objectiveId && !objectiveIds.has(t.objectiveId)) { t.objectiveId = null; fixes.objective++; }
    if (t.seriesId && !taskIds.has(t.seriesId)) { t.seriesId = null; t.kind = 'single'; fixes.series++; }
    t.dependsOn = t.dependsOn.filter((d) => taskIds.has(d));
  }
  for (const o of data.objectives) if (o.projectId && !projectIds.has(o.projectId)) { o.projectId = null; fixes.project++; }
  for (const h of data.habits) if (h.projectId && !projectIds.has(h.projectId)) { h.projectId = null; fixes.project++; }
  for (const s of data.sessions) {
    if (s.taskId && !taskIds.has(s.taskId)) { s.legacyRef = { ...(s.legacyRef || {}), missingTaskId: s.taskId }; s.taskId = null; fixes.task++; }
    if (s.projectId && !projectIds.has(s.projectId)) { s.projectId = null; fixes.project++; }
    if (s.objectiveId && !objectiveIds.has(s.objectiveId)) { s.objectiveId = null; fixes.objective++; }
  }
  const beforeHC = data.habitCompletions.length;
  data.habitCompletions = data.habitCompletions.filter((c) => habitIds.has(c.habitId));
  fixes.habit += beforeHC - data.habitCompletions.length;
  for (const p of data.dailyPlans) {
    if (p.dayWinTaskId && !taskIds.has(p.dayWinTaskId)) { p.dayWinTaskId = null; fixes.task++; }
    p.objectiveIds = p.objectiveIds.filter((o) => objectiveIds.has(o));
    if (p.habitIds) p.habitIds = p.habitIds.filter((h) => habitIds.has(h));
  }
  for (const s of data.streaks) s.habitIds = s.habitIds.filter((h) => habitIds.has(h));
  for (const a of data.activity) if (a.taskId && !taskIds.has(a.taskId)) a.taskId = null;
  const fixMsgs = [];
  if (fixes.project) fixMsgs.push(`${fixes.project} reference(s) to missing projects`);
  if (fixes.objective) fixMsgs.push(`${fixes.objective} reference(s) to missing objectives`);
  if (fixes.task) fixMsgs.push(`${fixes.task} reference(s) to missing tasks`);
  if (fixes.habit) fixMsgs.push(`${fixes.habit} completion(s) of missing habits`);
  if (fixes.series) fixMsgs.push(`${fixes.series} recurring occurrence(s) whose series is missing`);
  if (fixMsgs.length) warnings.push(`Cleared ${fixMsgs.join(', ')}. The records themselves were kept.`);

  return { data, warnings, errors };
}
