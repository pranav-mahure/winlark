/**
 * Tasks.
 *
 * Kinds:
 *   single      – an ordinary task
 *   series      – a recurring template; never appears on a day itself
 *   occurrence  – one dated instance generated from a series
 *
 * Status (single/occurrence): inbox → planned → in-progress → completed, or archived.
 * Completion is independent of Pomodoro progress: estimate, actual and status
 * are three separate facts.
 *
 * Rescheduling never rewrites history: moving a task appends to moveHistory,
 * so the original day still shows "Moved to Oct 1" instead of pretending the
 * task was never planned there.
 */
import { state, all, get, commit, memo } from '../core/state.js';
import { normalizeTask, ValidationError } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { todayKey, addDays, weekday, diffDays, isValidKey, parseNaturalDate } from '../utils/dates.js';
import { OPEN_STATUSES, PRIORITY_RANK } from '../core/constants.js';
import { taskActual, sessionsByTask, occurrencesBySeries } from './sessions.js';

export const isOpen = (t) => OPEN_STATUSES.has(t.status);
export const isDayTask = (t) => t.kind !== 'series';
export const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.createdAt - b.createdAt;
export const byPriority = (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byOrder(a, b);

export function taskById(id) { return get('tasks', id); }

/** Tasks currently planned on a date (any status but archived), in day order. */
export const tasksOn = memo((date) => all('tasks')
  .filter((t) => isDayTask(t) && t.plannedDate === date && t.status !== 'archived')
  .sort(byOrder));

/** Tasks that were planned on `date` but later moved elsewhere (history view). */
export const tasksMovedFrom = memo((date) => all('tasks')
  .filter((t) => isDayTask(t) && t.plannedDate !== date && t.moveHistory?.some((m) => m.from === date))
  .sort(byOrder));

export const openTasks = memo(() => all('tasks').filter((t) => isDayTask(t) && isOpen(t)).sort(byOrder));
export const unscheduledOpen = memo(() => openTasks().filter((t) => !t.plannedDate));
export const overdueOpen = memo((today) => openTasks().filter((t) => t.plannedDate && t.plannedDate < today)
  .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate) || byOrder(a, b)));
export const seriesList = memo(() => all('tasks').filter((t) => t.kind === 'series').sort(byOrder));

export function remainingPomos(task) {
  if (task.estimate == null) return null;
  return Math.max(0, task.estimate - taskActual(task.id).pomos);
}

/** Dependencies that are not completed yet (informational — never blocking). */
export function blockingTasks(task) {
  return (task.dependsOn || []).map((id) => get('tasks', id)).filter((t) => t && t.status !== 'completed' && t.status !== 'archived');
}

export function dependents(taskId) {
  return all('tasks').filter((t) => t.dependsOn?.includes(taskId));
}

function nextOrder(date) {
  const list = date ? tasksOn(date) : unscheduledOpen();
  return list.length ? Math.max(...list.map((t) => t.order ?? 0)) + 1024 : Date.now();
}

/**
 * Create a task (or a recurring series when `recurrence` is set).
 * Returns the created record (for a series: the series; the first occurrence
 * is generated for its start date if that is today or later).
 */
export async function createTask(fields) {
  const now = Date.now();
  const estimate = fields.estimate === '' || fields.estimate == null ? null : fields.estimate;
  if (fields.recurrence) {
    const start = fields.plannedDate || todayKey();
    const series = normalizeTask({
      ...fields, id: newId('t'), kind: 'series', status: 'active', plannedDate: null, estimate,
      recurrence: { ...fields.recurrence, startDate: fields.recurrence.startDate || start },
      estimateHistory: estimate != null ? [{ value: Number(estimate), at: now }] : [],
      order: nextOrder(null), createdAt: now, updatedAt: now,
    }, now);
    await commit({ put: { tasks: [series] } });
    await ensureOccurrences(todayKey());
    if (start > todayKey()) await ensureOccurrences(start);
    return series;
  }
  const plannedDate = fields.plannedDate || null;
  const rec = normalizeTask({
    ...fields, id: newId('t'), kind: 'single', estimate,
    status: plannedDate ? 'planned' : 'inbox', plannedDate,
    estimateHistory: estimate != null ? [{ value: Number(estimate), at: now }] : [],
    order: fields.order ?? nextOrder(plannedDate), createdAt: now, updatedAt: now,
  }, now);
  await commit({ put: { tasks: [rec] } });
  return rec;
}

/** Fields of a series that propagate to its open, upcoming occurrences. */
const SERIES_SHARED = ['title', 'notes', 'priority', 'projectId', 'objectiveId', 'tags', 'estimate'];

/**
 * Update a task. Handles side effects:
 *  - estimate changes are appended to estimateHistory (originalEstimate is kept)
 *  - plannedDate changes go through moveHistory
 *  - project/objective changes follow through to the task's sessions
 *  - series edits propagate to open occurrences from today on
 */
export async function updateTask(id, patch) {
  const cur = get('tasks', id);
  if (!cur) throw new Error('Task not found');
  const now = Date.now();
  const next = { ...cur, ...patch, id, kind: cur.kind, updatedAt: now };
  const put = { tasks: [], sessions: [] };

  if ('estimate' in patch) {
    const val = patch.estimate === '' || patch.estimate == null ? null : Number(patch.estimate);
    next.estimate = val;
    if (val !== cur.estimate && val != null) {
      next.estimateHistory = [...(cur.estimateHistory || []), { value: val, at: now }];
      if (cur.originalEstimate == null) next.originalEstimate = val;
    }
  }
  if ('plannedDate' in patch && patch.plannedDate !== cur.plannedDate && cur.kind !== 'series') {
    next.moveHistory = [...(cur.moveHistory || []), { from: cur.plannedDate || null, to: patch.plannedDate || null, at: now }];
    if (isOpen(cur)) next.status = patch.plannedDate ? (cur.status === 'in-progress' ? 'in-progress' : 'planned') : (cur.status === 'in-progress' ? 'in-progress' : 'inbox');
  }
  if (cur.kind === 'series' && patch.recurrence !== undefined) {
    next.recurrence = patch.recurrence ? { ...patch.recurrence, startDate: patch.recurrence.startDate || cur.recurrence?.startDate || todayKey() } : cur.recurrence;
  }
  const rec = normalizeTask(next, now);
  put.tasks.push(rec);

  if (rec.projectId !== cur.projectId || rec.objectiveId !== cur.objectiveId) {
    for (const s of sessionsByTask().get(id) || []) {
      put.sessions.push({ ...s, projectId: rec.projectId, objectiveId: rec.objectiveId, updatedAt: now });
    }
  }
  if (cur.kind === 'series') {
    const today = todayKey();
    const changed = SERIES_SHARED.filter((k) => JSON.stringify(cur[k]) !== JSON.stringify(rec[k]));
    if (changed.length) {
      for (const occ of occurrencesBySeries().get(id) || []) {
        if (!isOpen(occ) || (occ.plannedDate && occ.plannedDate < today)) continue;
        const o = { ...occ, updatedAt: now };
        for (const k of changed) o[k] = rec[k];
        if (changed.includes('estimate') && rec.estimate !== occ.estimate) {
          o.estimateHistory = [...(occ.estimateHistory || []), { value: rec.estimate, at: now, source: 'series' }];
        }
        put.tasks.push(normalizeTask(o, now));
      }
    }
  }
  await commit({ put });
  if (cur.kind === 'series' && patch.recurrence) await ensureOccurrences(todayKey());
  return rec;
}

export async function moveTask(id, toDate) {
  if (toDate !== null && !isValidKey(toDate)) throw new ValidationError('Choose a valid date', 'date');
  return updateTask(id, { plannedDate: toDate });
}

export async function completeTask(id) {
  const cur = get('tasks', id);
  if (!cur || cur.status === 'completed') return cur;
  const now = Date.now();
  const rec = normalizeTask({ ...cur, status: 'completed', completedAt: now, completedDate: todayKey(), updatedAt: now }, now);
  const put = { tasks: [rec] };
  // Objectives with the "all tasks" rule complete themselves.
  if (rec.objectiveId) {
    const obj = get('objectives', rec.objectiveId);
    if (obj && obj.status === 'active' && obj.completionRule === 'all-tasks') {
      const siblings = all('tasks').filter((t) => t.objectiveId === obj.id && t.kind !== 'series' && t.status !== 'archived');
      if (siblings.every((t) => t.id === id || t.status === 'completed')) {
        put.objectives = [{ ...obj, status: 'completed', completedAt: now, completedDate: todayKey(), updatedAt: now }];
      }
    }
  }
  await commit({ put });
  return rec;
}

export async function reopenTask(id) {
  const cur = get('tasks', id);
  if (!cur) return null;
  const now = Date.now();
  const started = taskActual(id).pomos > 0;
  const status = started ? 'in-progress' : (cur.plannedDate ? 'planned' : 'inbox');
  const rec = normalizeTask({ ...cur, status, completedAt: null, completedDate: null, archivedAt: null, updatedAt: now }, now);
  await commit({ put: { tasks: [rec] } });
  return rec;
}

export async function archiveTask(id) {
  const cur = get('tasks', id);
  if (!cur) return null;
  const now = Date.now();
  const rec = normalizeTask({ ...cur, status: 'archived', archivedAt: now, updatedAt: now }, now);
  return commit({ put: { tasks: [rec] } });
}

export async function unarchiveTask(id) {
  const cur = get('tasks', id);
  if (!cur) return null;
  if (cur.kind === 'series') {
    const now = Date.now();
    await commit({ put: { tasks: [normalizeTask({ ...cur, status: 'active', archivedAt: null, updatedAt: now }, now)] } });
    return ensureOccurrences(todayKey());
  }
  if (cur.completedAt) {
    const now = Date.now();
    return commit({ put: { tasks: [normalizeTask({ ...cur, status: 'completed', archivedAt: null, updatedAt: now }, now)] } });
  }
  return reopenTask(id);
}

/**
 * Delete a task. Its focus sessions are kept as unassigned history unless
 * deleteSessions is true. For a series, upcoming open occurrences are removed
 * and past/completed ones are kept as plain tasks.
 * Returns the inverse change set (Undo).
 */
export async function deleteTask(id, { deleteSessions = false } = {}) {
  const cur = get('tasks', id);
  if (!cur) return null;
  const now = Date.now();
  const del = { tasks: [id], sessions: [] };
  const put = { tasks: [], sessions: [], dailyPlans: [] };
  const removeIds = new Set([id]);

  if (cur.kind === 'series') {
    const today = todayKey();
    for (const occ of occurrencesBySeries().get(id) || []) {
      const hasHistory = (sessionsByTask().get(occ.id) || []).length > 0 || occ.status === 'completed';
      if (isOpen(occ) && occ.plannedDate >= today && !hasHistory) { del.tasks.push(occ.id); removeIds.add(occ.id); }
      else put.tasks.push({ ...occ, kind: 'single', seriesId: null, updatedAt: now });
    }
  }
  for (const rid of removeIds) {
    for (const s of sessionsByTask().get(rid) || []) {
      if (deleteSessions) del.sessions.push(s.id);
      else put.sessions.push({ ...s, taskId: null, legacyRef: { ...(s.legacyRef || {}), deletedTaskTitle: cur.title }, updatedAt: now });
    }
  }
  for (const t of all('tasks')) {
    if (removeIds.has(t.id)) continue;
    if (t.dependsOn?.some((d) => removeIds.has(d))) put.tasks.push({ ...t, dependsOn: t.dependsOn.filter((d) => !removeIds.has(d)), updatedAt: now });
  }
  for (const p of all('dailyPlans')) {
    if (p.dayWinTaskId && removeIds.has(p.dayWinTaskId)) {
      put.dailyPlans.push({ ...p, dayWinTaskId: null, dayWinHistory: [...(p.dayWinHistory || []), { taskId: p.dayWinTaskId, action: 'deleted', at: now, title: cur.title }], updatedAt: now });
    }
  }
  return commit({ put, del });
}

export async function duplicateTask(id) {
  const cur = get('tasks', id);
  if (!cur || cur.kind === 'series') return null;
  return createTask({
    title: `${cur.title} (copy)`, notes: cur.notes, priority: cur.priority, projectId: cur.projectId,
    objectiveId: cur.objectiveId, tags: cur.tags, estimate: cur.estimate, plannedDate: cur.plannedDate, dueDate: cur.dueDate,
  });
}

/** Persist a new order for a list of task IDs (only changed rows are written). */
export async function setOrder(ids) {
  const now = Date.now();
  const put = [];
  ids.forEach((id, i) => {
    const t = get('tasks', id);
    const order = (i + 1) * 1024;
    if (t && t.order !== order) put.push({ ...t, order, updatedAt: now });
  });
  if (put.length) await commit({ put: { tasks: put } });
}

/** Move a task one step up (-1) or down (+1) inside an ordered list of IDs. */
export async function nudgeTask(id, ids, dir) {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return;
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  await setOrder(next);
}

// ---------- recurrence ----------
export function seriesMatches(series, date) {
  const r = series.recurrence;
  if (!r || series.status !== 'active') return false;
  if (r.startDate && date < r.startDate) return false;
  if (series.skippedDates?.includes(date)) return false;
  const wd = weekday(date);
  switch (r.freq) {
    case 'daily': return true;
    case 'weekdays': return wd >= 1 && wd <= 5;
    case 'weekly': return r.days.includes(wd);
    case 'interval': return diffDays(r.startDate || date, date) % (r.interval || 1) === 0;
    default: return false;
  }
}

export function describeRecurrence(r) {
  if (!r) return '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (r.freq) {
    case 'daily': return 'Every day';
    case 'weekdays': return 'Weekdays';
    case 'weekly': return `Weekly on ${r.days.map((d) => names[d]).join(', ')}`;
    case 'interval': return `Every ${r.interval} days`;
    default: return '';
  }
}

/**
 * Generate occurrences of active series for a date (today or later only —
 * past days are history and are never back-filled). Idempotent: occurrence
 * IDs are derived from series ID + date.
 */
export async function ensureOccurrences(date) {
  if (!isValidKey(date) || date < todayKey()) return [];
  const existing = new Set();
  for (const t of state.tasks.values()) if (t.kind === 'occurrence') existing.add(`${t.seriesId}|${t.occurrenceDate || t.plannedDate}`);
  const now = Date.now();
  const created = [];
  for (const s of seriesList()) {
    if (!seriesMatches(s, date) || existing.has(`${s.id}|${date}`) || state.tasks.has(`${s.id}~${date}`)) continue;
    const occ = normalizeTask({
      id: `${s.id}~${date}`, kind: 'occurrence', seriesId: s.id, title: s.title, notes: s.notes,
      priority: s.priority, projectId: s.projectId, objectiveId: s.objectiveId, tags: s.tags,
      estimate: s.estimate, originalEstimate: s.estimate,
      estimateHistory: s.estimate != null ? [{ value: s.estimate, at: now, source: 'series' }] : [],
      plannedDate: date, occurrenceDate: date, status: 'planned', order: s.order, createdAt: now, updatedAt: now,
      estimateReliable: s.estimateReliable,
    }, now);
    created.push(occ);
  }
  if (created.length) await commit({ put: { tasks: created } });
  return created;
}

/** Stop a series from generating a specific day (used when an occurrence is deleted). */
export async function skipOccurrence(seriesId, date) {
  const s = get('tasks', seriesId);
  if (!s || s.kind !== 'series') return;
  const skippedDates = [...new Set([...(s.skippedDates || []), date])];
  await commit({ put: { tasks: [{ ...s, skippedDates, updatedAt: Date.now() }] } });
}

/**
 * Turn an existing single task into the first occurrence of a new series.
 * The task keeps its ID (and therefore its sessions).
 */
export async function makeRecurring(id, recurrence) {
  const cur = get('tasks', id);
  if (!cur || cur.kind !== 'single') return null;
  const now = Date.now();
  const start = cur.plannedDate || todayKey();
  const series = normalizeTask({
    id: newId('t'), kind: 'series', status: 'active', title: cur.title, notes: cur.notes, priority: cur.priority,
    projectId: cur.projectId, objectiveId: cur.objectiveId, tags: cur.tags, estimate: cur.estimate,
    estimateHistory: cur.estimate != null ? [{ value: cur.estimate, at: now }] : [],
    recurrence: { ...recurrence, startDate: start }, order: cur.order, createdAt: now, updatedAt: now,
  }, now);
  const occ = { ...cur, kind: 'occurrence', seriesId: series.id, plannedDate: start, occurrenceDate: start,
    status: cur.status === 'inbox' ? 'planned' : cur.status, updatedAt: now };
  await commit({ put: { tasks: [series, normalizeTask(occ, now)] } });
  await ensureOccurrences(todayKey());
  return series;
}

export async function stopRepeating(seriesId) {
  const s = get('tasks', seriesId);
  if (!s || s.kind !== 'series') return;
  const now = Date.now();
  const del = [];
  const today = todayKey();
  for (const occ of occurrencesBySeries().get(seriesId) || []) {
    const hasHistory = (sessionsByTask().get(occ.id) || []).length > 0;
    if (isOpen(occ) && occ.plannedDate > today && !hasHistory) del.push(occ.id);
  }
  await commit({ put: { tasks: [normalizeTask({ ...s, status: 'archived', archivedAt: now, updatedAt: now }, now)] }, del: { tasks: del } });
}

// ---------- quick add ----------
/**
 * Parse quick-add syntax:
 *   ~3        3 Pomodoros         !high / !h / !1   priority
 *   #tag      tag                 @tomorrow @fri @2026-10-03 @+2   date
 *   +Project  project (prefix match on name, spaces ignored)
 *   *         make it the Day Win
 */
export function parseQuickAdd(input, { today = todayKey(), projects = [] } = {}) {
  const out = { title: '', estimate: null, priority: null, tags: [], plannedDate: undefined, projectId: null, dayWin: false, tokens: [] };
  const words = String(input || '').trim().split(/\s+/).filter(Boolean);
  const rest = [];
  for (const w of words) {
    let m;
    if ((m = /^~(\d{1,3})$/.exec(w))) { out.estimate = Math.min(999, +m[1]); out.tokens.push(w); continue; }
    if ((m = /^!(h|high|1|m|med|medium|2|l|low|3)$/i.exec(w))) {
      const v = m[1].toLowerCase();
      out.priority = ['h', 'high', '1'].includes(v) ? 'high' : ['m', 'med', 'medium', '2'].includes(v) ? 'med' : 'low';
      out.tokens.push(w); continue;
    }
    if ((m = /^#([\p{L}\p{N}_-]{1,40})$/u.exec(w))) { out.tags.push(m[1].toLowerCase()); out.tokens.push(w); continue; }
    if ((m = /^@(.+)$/.exec(w))) {
      const v = m[1].toLowerCase();
      if (v === 'none' || v === 'inbox' || v === 'someday') { out.plannedDate = null; out.tokens.push(w); continue; }
      const d = parseNaturalDate(v, today);
      if (d) { out.plannedDate = d; out.tokens.push(w); continue; }
    }
    if ((m = /^\+(\S{2,})$/.exec(w)) && projects.length) {
      const q = m[1].toLowerCase();
      const p = projects.find((x) => x.name.toLowerCase().replace(/\s+/g, '') === q)
        || projects.find((x) => x.name.toLowerCase().replace(/\s+/g, '').startsWith(q));
      if (p) { out.projectId = p.id; out.tokens.push(w); continue; }
    }
    if (w === '*' || w === '★') { out.dayWin = true; out.tokens.push(w); continue; }
    rest.push(w);
  }
  out.title = rest.join(' ');
  return out;
}

export function searchTasks(q, limit = 20) {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return all('tasks')
    .filter((t) => t.title.toLowerCase().includes(s) || t.notes?.toLowerCase().includes(s) || t.tags?.some((g) => g.includes(s)))
    .sort((a, b) => (isOpen(b) - isOpen(a)) || (a.title.toLowerCase().indexOf(s) - b.title.toLowerCase().indexOf(s)))
    .slice(0, limit);
}

export function allTags() {
  const set = new Set();
  for (const t of state.tasks.values()) for (const g of t.tags || []) set.add(g);
  return [...set].sort();
}

/** Compact status label for a task on a given day (neutral wording). */
export function dayStatus(task, date, today = todayKey()) {
  if (task.plannedDate !== date) {
    const move = [...(task.moveHistory || [])].reverse().find((m) => m.from === date);
    return { key: 'moved', label: move?.to ? `Moved to ${move.to}` : 'Unscheduled', to: move?.to ?? null };
  }
  if (task.status === 'completed') return { key: 'completed', label: 'Completed' };
  if (date < today) return { key: 'incomplete', label: 'Not completed' };
  if (task.status === 'in-progress') return { key: 'in-progress', label: 'In progress' };
  return { key: 'open', label: 'Open' };
}

export { taskActual, addDays };
