/**
 * Analytics — every number here is derived from stored records.
 *
 * Definitions (shown to the user in the Analytics area):
 *   Pomodoro count    completed focus sessions
 *   Focus time        sum of completed focus sessions' actual duration
 *   Task actual       completed focus sessions linked to the task
 *   Task planned      the estimate given when the task was created/planned
 *                     (originalEstimate; "latest estimate" is an option)
 *   Variance          actual − planned
 *   Tasks completed   tasks whose completion date is that day (+ v1
 *                     recurring completions imported from history)
 *   Day Win           completed when the Day Win task was completed on/before that day
 *
 * Nothing is stored; results are memoized on state.version, so clearing the
 * caches ("Recalculate analytics") always rebuilds them from the records.
 */
import { state, all, get, memo } from '../core/state.js';
import { addDays, rangeKeys, startOfWeek, keyFromTs, todayKey, weekday, diffDays } from '../utils/dates.js';
import { isCountedFocus, taskActual } from './sessions.js';
import { tasksOn, tasksMovedFrom } from './tasks.js';
import { getPlan, dayWinStatus, planObjectiveIds, habitIdsFor } from './daily-plan.js';
import { objectiveDayResult, objectiveProgress } from './objectives.js';
import { isDone as habitDone, isScheduled, listHabits, habitRate } from './habits.js';

const NONE = '_none';

/** date → { pomos, sec, breaks, breakSec, stopped, proj: { pid: {pomos, sec} } } */
export const dayIndex = memo(() => {
  const m = new Map();
  for (const s of state.sessions.values()) {
    let d = m.get(s.date);
    if (!d) { d = { pomos: 0, sec: 0, breaks: 0, breakSec: 0, stopped: 0, proj: {} }; m.set(s.date, d); }
    if (s.type === 'focus') {
      if (!s.completed) { d.stopped++; continue; }
      d.pomos++; d.sec += s.actualDuration || 0;
      const k = s.projectId || NONE;
      const p = d.proj[k] || (d.proj[k] = { pomos: 0, sec: 0 });
      p.pomos++; p.sec += s.actualDuration || 0;
    } else if (s.completed) {
      d.breaks++; d.breakSec += s.actualDuration || 0;
    }
  }
  return m;
});

/** date → list of completions { taskId, title, projectId, source } */
export const completionIndex = memo(() => {
  const m = new Map();
  const push = (date, rec) => { if (!date) return; if (!m.has(date)) m.set(date, []); m.get(date).push(rec); };
  for (const t of state.tasks.values()) {
    if (t.kind === 'series' || !t.completedDate) continue;
    if (t.status !== 'completed' && t.status !== 'archived') continue;
    push(t.completedDate, { taskId: t.id, title: t.title, projectId: t.projectId, source: 'task' });
  }
  for (const a of state.activity.values()) {
    if (a.type === 'task-completed' && a.countsAsCompletion) push(a.date, { taskId: a.taskId, title: a.title, projectId: a.projectId, source: 'history' });
  }
  return m;
});

export function focusOn(date, projectId = null) {
  const d = dayIndex().get(date);
  if (!d) return { pomos: 0, sec: 0, min: 0 };
  if (!projectId) return { pomos: d.pomos, sec: d.sec, min: d.sec / 60 };
  const p = d.proj[projectId] || { pomos: 0, sec: 0 };
  return { pomos: p.pomos, sec: p.sec, min: p.sec / 60 };
}

export function completionsOn(date, projectId = null) {
  const list = completionIndex().get(date) || [];
  return projectId ? list.filter((c) => c.projectId === projectId) : list;
}

/** Tasks that belonged to a day: still planned there, or moved away from it. */
export function dayTasks(date) {
  const planned = tasksOn(date);
  const moved = tasksMovedFrom(date);
  const doneOnTime = (t) => t.status === 'completed' && t.completedDate && t.completedDate <= date;
  return { planned, moved, total: planned.length + moved.length, completed: planned.filter(doneOnTime).length, doneOnTime };
}

export function habitsOn(date) {
  const ids = habitIdsFor(date);
  const done = ids.filter((id) => habitDone(id, date)).length;
  return { ids, done, total: ids.length };
}

export function objectivesOn(date) {
  const ids = planObjectiveIds(date);
  const results = ids.map((id) => objectiveDayResult(id, date)).filter(Boolean);
  return { ids, results, done: results.filter((r) => r.done).length, total: results.length };
}

/** Everything known about one day. */
export function dayStats(date) {
  const f = focusOn(date);
  const t = dayTasks(date);
  const dw = dayWinStatus(date);
  return {
    date,
    pomos: f.pomos,
    focusMin: f.min,
    tasksCompleted: completionsOn(date).length,
    tasksPlanned: t.total,
    tasksPlannedDone: t.completed,
    dayWin: dw.key,
    dayWinTask: dw.task,
    habits: habitsOn(date),
    objectives: objectivesOn(date),
  };
}

/** First date with any recorded activity (or today). */
export const firstDataDate = memo(() => {
  let min = todayKey();
  const consider = (k) => { if (k && k < min) min = k; };
  for (const s of state.sessions.values()) consider(s.date);
  for (const k of completionIndex().keys()) consider(k);
  for (const c of state.habitCompletions.values()) consider(c.date);
  for (const p of state.dailyPlans.values()) consider(p.date);
  return min;
});

// ---------- period helpers ----------
export function periodRange(kind, anchor = todayKey(), weekStart = state.settings.general.weekStart) {
  switch (kind) {
    case 'week': { const s = startOfWeek(anchor, weekStart); return { start: s, end: addDays(s, 6) }; }
    case 'month': { const s = anchor.slice(0, 8) + '01'; const d = new Date(+s.slice(0, 4), +s.slice(5, 7), 0); return { start: s, end: `${s.slice(0, 8)}${String(d.getDate()).padStart(2, '0')}` }; }
    case 'year': return { start: anchor.slice(0, 4) + '-01-01', end: anchor.slice(0, 4) + '-12-31' };
    default: return { start: anchor, end: anchor };
  }
}

export function shiftPeriod(kind, anchor, dir) {
  if (kind === 'week') return addDays(anchor, 7 * dir);
  if (kind === 'month') { const d = new Date(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1 + dir, 1, 12); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
  if (kind === 'year') return `${+anchor.slice(0, 4) + dir}-01-01`;
  return anchor;
}

/** Per-day series across a range. Keys beyond today are included (as zero). */
export function dailySeries(start, end, { projectId = null } = {}) {
  return rangeKeys(start, end).map((date) => {
    const f = focusOn(date, projectId);
    return { date, pomos: f.pomos, focusMin: f.min, completed: completionsOn(date, projectId).length };
  });
}

/** Group a daily series into buckets (used for year views). */
export function bucketSeries(series, by = 'month', weekStart = 1) {
  const map = new Map();
  for (const d of series) {
    const key = by === 'month' ? d.date.slice(0, 7) : startOfWeek(d.date, weekStart);
    const b = map.get(key) || { key, pomos: 0, focusMin: 0, completed: 0, days: 0 };
    b.pomos += d.pomos; b.focusMin += d.focusMin; b.completed += d.completed; b.days++;
    map.set(key, b);
  }
  return [...map.values()];
}

export function summary(start, end, { projectId = null } = {}) {
  const series = dailySeries(start, end, { projectId });
  const today = todayKey();
  let pomos = 0; let min = 0; let active = 0; let completed = 0; let best = null;
  for (const d of series) {
    pomos += d.pomos; min += d.focusMin; completed += d.completed;
    if (d.pomos > 0) active++;
    if (!best || d.focusMin > best.focusMin) best = d;
  }
  let breaks = 0; let stopped = 0;
  for (const k of rangeKeys(start, end)) { const d = dayIndex().get(k); if (d) { breaks += d.breaks; stopped += d.stopped; } }
  let winsSet = 0; let winsDone = 0;
  if (!projectId) {
    for (const k of rangeKeys(start, end > today ? today : end)) {
      const st = dayWinStatus(k).key;
      if (st !== 'none') winsSet++;
      if (st === 'completed') winsDone++;
    }
  }
  const elapsed = rangeKeys(start, end > today ? today : end).length;
  return {
    pomos, focusMin: min, activeDays: active, days: series.length, elapsedDays: elapsed, completed,
    avgPerActiveDay: active ? min / active : 0, avgPomosPerActiveDay: active ? pomos / active : 0,
    best: best && best.focusMin > 0 ? best : null, breaks, stopped, winsSet, winsDone,
  };
}

export function focusByProject(start, end) {
  const totals = new Map();
  for (const k of rangeKeys(start, end)) {
    const d = dayIndex().get(k);
    if (!d) continue;
    for (const [pid, v] of Object.entries(d.proj)) {
      const t = totals.get(pid) || { projectId: pid === NONE ? null : pid, pomos: 0, min: 0 };
      t.pomos += v.pomos; t.min += v.sec / 60;
      totals.set(pid, t);
    }
  }
  return [...totals.values()].map((t) => {
    const p = t.projectId ? get('projects', t.projectId) : null;
    return { ...t, name: p ? p.name : 'No project', color: p ? p.color : 'var(--text-3)' };
  }).sort((a, b) => b.min - a.min);
}

/** Focus minutes by hour of day. Legacy sessions have no start time and are counted separately. */
export function hourDistribution(start, end, { projectId = null } = {}) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, min: 0, pomos: 0 }));
  let untimed = 0;
  for (const s of state.sessions.values()) {
    if (!isCountedFocus(s) || s.date < start || s.date > end) continue;
    if (projectId && s.projectId !== projectId) continue;
    if (!s.startTime) { untimed++; continue; }
    // Spread the session across the hours it actually covered.
    let t = s.startTime;
    const endT = s.endTime || s.startTime + (s.actualDuration || 0) * 1000;
    const h0 = new Date(t).getHours();
    hours[h0].pomos++;
    let guard = 0;
    while (t < endT && guard++ < 48) {
      const d = new Date(t);
      const nextHour = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
      const segEnd = Math.min(endT, nextHour);
      hours[d.getHours()].min += (segEnd - t) / 60000;
      t = segEnd;
    }
  }
  return { hours, untimed };
}

export function weekdayDistribution(start, end, { projectId = null } = {}) {
  const days = Array.from({ length: 7 }, (_, i) => ({ weekday: i, min: 0, pomos: 0, count: 0 }));
  for (const k of rangeKeys(start, end)) {
    const f = focusOn(k, projectId);
    const w = days[weekday(k)];
    w.min += f.min; w.pomos += f.pomos; w.count++;
  }
  return days.map((d) => ({ ...d, avgMin: d.count ? d.min / d.count : 0 }));
}

export function heatmapData(start, end, metric = 'focusMin') {
  const days = dailySeries(start, end).map((d) => ({ date: d.date, value: metric === 'pomos' ? d.pomos : d.focusMin, pomos: d.pomos, focusMin: d.focusMin }));
  const values = days.map((d) => d.value).filter((v) => v > 0).sort((a, b) => a - b);
  // Quartile thresholds so a single huge day doesn't wash out the rest.
  const q = (p) => values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : 0;
  const thresholds = [q(0.25), q(0.5), q(0.75)];
  for (const d of days) {
    d.level = d.value <= 0 ? 0 : d.value <= thresholds[0] ? 1 : d.value <= thresholds[1] ? 2 : d.value <= thresholds[2] ? 3 : 4;
  }
  return { days, max: values.length ? values[values.length - 1] : 0, thresholds };
}

// ---------- planned vs actual ----------
function plannedFor(t, basis) {
  const v = basis === 'latest' ? t.estimate : (t.originalEstimate ?? t.estimate);
  return v == null ? null : v;
}

function anchorDate(t) {
  return t.completedDate || t.plannedDate || keyFromTs(t.createdAt || Date.now());
}

/**
 * Planned vs actual for tasks with an estimate.
 * scope 'completed' (default) compares finished work only; 'all' includes
 * started tasks too. v1 estimates that may have been auto-raised are
 * excluded unless includeUnreliable is set.
 */
export function plannedVsActual({ start = null, end = null, basis = 'original', includeUnreliable = false, scope = 'completed', projectId = null } = {}) {
  const focusMin = state.settings.timer.focusMin;
  const rows = [];
  let excludedUnreliable = 0;
  for (const t of state.tasks.values()) {
    if (t.kind === 'series') continue;
    const planned = plannedFor(t, basis);
    if (planned == null || planned <= 0) continue;
    if (projectId && t.projectId !== projectId) continue;
    const a = taskActual(t.id);
    if (scope === 'completed' ? t.status !== 'completed' : !(t.status === 'completed' || a.pomos > 0)) continue;
    const anchor = anchorDate(t);
    if ((start && anchor < start) || (end && anchor > end)) continue;
    if (t.estimateReliable === false && !includeUnreliable) { excludedUnreliable++; continue; }
    rows.push({
      task: t, planned, actual: a.pomos, variance: a.pomos - planned,
      plannedMin: planned * focusMin, actualMin: a.minutes, anchor,
    });
  }
  rows.sort((x, y) => y.anchor.localeCompare(x.anchor));
  const agg = aggregate(rows);
  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const r of rows) {
      for (const k of [].concat(keyFn(r))) {
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(r);
      }
    }
    return [...m.entries()].map(([k, list]) => ({ key: k, label: labelFn(k), ...aggregate(list) })).sort((a, b) => b.planned + b.actual - a.planned - a.actual);
  };
  const byProject = group((r) => r.task.projectId || NONE, (k) => (k === NONE ? 'No project' : get('projects', k)?.name || 'Deleted project'));
  const byObjective = group((r) => r.task.objectiveId || NONE, (k) => (k === NONE ? 'No objective' : get('objectives', k)?.title || 'Deleted objective'));
  const byTag = group((r) => (r.task.tags?.length ? r.task.tags : [NONE]), (k) => (k === NONE ? 'Untagged' : `#${k}`));
  const ws = state.settings.general.weekStart;
  const byWeek = group((r) => startOfWeek(r.anchor, ws), (k) => k).sort((a, b) => a.key.localeCompare(b.key));
  const underestimatedGroups = [...byProject, ...byTag]
    .filter((g) => g.key !== NONE && g.count >= 3 && g.ratio >= 1.15)
    .sort((a, b) => b.ratio - a.ratio);
  return { rows, ...agg, byProject, byObjective, byTag, byWeek, underestimatedGroups, excludedUnreliable, basis, scope };
}

function aggregate(rows) {
  let planned = 0; let actual = 0; let plannedMin = 0; let actualMin = 0; let within = 0; let under = 0; let over = 0; let exact = 0;
  for (const r of rows) {
    planned += r.planned; actual += r.actual; plannedMin += r.plannedMin; actualMin += r.actualMin;
    if (Math.abs(r.variance) <= 1) within++;
    if (r.variance > 0) under++; else if (r.variance < 0) over++; else exact++;
  }
  return {
    count: rows.length, planned, actual, variance: actual - planned, plannedMin, actualMin,
    ratio: planned ? actual / planned : 0, withinOne: rows.length ? within / rows.length : 0,
    underestimated: under, overestimated: over, exact,
  };
}

/** Planned focus (from saved plan snapshot, else current estimates) vs actual focus per day. */
export function dailyPlanVsActual(start, end) {
  const focusMin = state.settings.timer.focusMin;
  const today = todayKey();
  return rangeKeys(start, end).map((date) => {
    const plan = getPlan(date);
    let plannedMin;
    let source;
    if (plan.snapshot?.plannedFocusMin != null) { plannedMin = plan.snapshot.plannedFocusMin; source = 'saved plan'; }
    else {
      const { planned, moved } = dayTasks(date);
      plannedMin = [...planned, ...moved].reduce((s, t) => s + (t.estimate || 0), 0) * focusMin;
      source = 'task estimates';
    }
    return { date, plannedMin, actualMin: focusOn(date).min, source, future: date > today };
  });
}

export function dayWinHistory(start, end) {
  const today = todayKey();
  return rangeKeys(start, end > today ? today : end).map((date) => ({ date, ...dayWinStatus(date) }));
}

export function habitConsistency(start, end) {
  const today = todayKey();
  const stop = end > today ? today : end;
  const habits = listHabits().map((h) => ({ habit: h, ...habitRate(h, start, stop) }));
  const days = rangeKeys(start, stop).map((date) => {
    const scheduled = listHabits({ includeInactive: false }).filter((h) => isScheduled(h, date));
    const done = scheduled.filter((h) => habitDone(h.id, date)).length;
    return { date, scheduled: scheduled.length, done, ratio: scheduled.length ? done / scheduled.length : null };
  });
  return { habits, days };
}

export function objectiveStats(start, end) {
  const objectives = all('objectives');
  const completedInRange = objectives.filter((o) => o.completedDate && o.completedDate >= start && o.completedDate <= end);
  const active = objectives.filter((o) => o.status === 'active').map((o) => ({ objective: o, ...objectiveProgress(o.id) }))
    .sort((a, b) => b.ratio - a.ratio);
  const focus = new Map();
  for (const s of state.sessions.values()) {
    if (!isCountedFocus(s) || !s.objectiveId || s.date < start || s.date > end) continue;
    focus.set(s.objectiveId, (focus.get(s.objectiveId) || 0) + (s.actualDuration || 0) / 60);
  }
  const focusByObjective = [...focus.entries()].map(([id, min]) => ({ id, min, title: get('objectives', id)?.title || 'Deleted objective' }))
    .sort((a, b) => b.min - a.min);
  return { completedInRange, active, focusByObjective, total: objectives.length };
}

export function taskStats(start, end, { projectId = null } = {}) {
  const today = todayKey();
  const series = rangeKeys(start, end).map((date) => {
    const t = date <= today ? dayTasks(date) : { total: tasksOn(date).length, completed: 0 };
    return { date, planned: t.total, plannedDone: t.completed, completed: completionsOn(date, projectId).length };
  });
  const tasks = all('tasks').filter((t) => t.kind !== 'series' && (!projectId || t.projectId === projectId));
  const created = tasks.filter((t) => { const k = keyFromTs(t.createdAt || 0); return k >= start && k <= end; }).length;
  const moved = tasks.reduce((n, t) => n + (t.moveHistory || []).filter((m) => m.at && keyFromTs(m.at) >= start && keyFromTs(m.at) <= end).length, 0);
  const totals = series.reduce((a, d) => ({ planned: a.planned + d.planned, plannedDone: a.plannedDone + d.plannedDone, completed: a.completed + d.completed }), { planned: 0, plannedDone: 0, completed: 0 });
  const byPriority = { high: 0, med: 0, low: 0 };
  for (const d of series) for (const c of completionsOn(d.date, projectId)) { const t = c.taskId && get('tasks', c.taskId); if (t) byPriority[t.priority]++; }
  return { series, created, moved, ...totals, byPriority };
}

export function projectStats(projectId) {
  const tasks = all('tasks').filter((t) => t.projectId === projectId && t.kind !== 'series');
  const series = all('tasks').filter((t) => t.projectId === projectId && t.kind === 'series');
  let pomos = 0; let sec = 0; let lastDate = null;
  const recent = [];
  for (const s of state.sessions.values()) {
    if (s.projectId !== projectId || !isCountedFocus(s)) continue;
    pomos++; sec += s.actualDuration || 0;
    if (!lastDate || s.date > lastDate) lastDate = s.date;
    recent.push(s);
  }
  recent.sort((a, b) => b.date.localeCompare(a.date) || (b.endTime || 0) - (a.endTime || 0));
  const pva = plannedVsActual({ projectId, includeUnreliable: false });
  const today = todayKey();
  const ws = state.settings.general.weekStart;
  const weeks = [];
  let wk = startOfWeek(addDays(today, -7 * 11), ws);
  for (let i = 0; i < 12; i++) {
    const end = addDays(wk, 6);
    let p = 0; let m = 0;
    for (const k of rangeKeys(wk, end)) { const f = focusOn(k, projectId); p += f.pomos; m += f.min; }
    weeks.push({ start: wk, pomos: p, focusMin: m });
    wk = addDays(wk, 7);
  }
  const estimated = tasks.reduce((n, t) => n + (t.estimate || 0), 0);
  return {
    pomos, focusMin: sec / 60, lastDate,
    activeTasks: tasks.filter((t) => ['inbox', 'planned', 'in-progress'].includes(t.status)).length,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    totalTasks: tasks.length, recurring: series.length,
    objectives: all('objectives').filter((o) => o.projectId === projectId),
    estimatedPomos: estimated, pva, weeks, recent: recent.slice(0, 12),
    daysSinceActive: lastDate ? diffDays(lastDate, today) : null,
  };
}

export { NONE };
