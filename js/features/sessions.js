/**
 * Sessions are the single source of truth for focus history.
 * Pomodoro count  = number of completed focus sessions.
 * Focus time      = sum of completed focus sessions' actualDuration.
 * Task actual     = completed focus sessions linked to the task.
 * Everything else (daily totals, project totals, streaks) is derived.
 */
import { state, all, get, commit, memo } from '../core/state.js';
import { normalizeSession } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { keyFromTs } from '../utils/dates.js';

export const isCountedFocus = (s) => s.type === 'focus' && s.completed;

export const sessionsByTask = memo(() => {
  const m = new Map();
  for (const s of state.sessions.values()) {
    if (!s.taskId) continue;
    if (!m.has(s.taskId)) m.set(s.taskId, []);
    m.get(s.taskId).push(s);
  }
  return m;
});

export const sessionsByDate = memo(() => {
  const m = new Map();
  for (const s of state.sessions.values()) {
    if (!m.has(s.date)) m.set(s.date, []);
    m.get(s.date).push(s);
  }
  return m;
});

export const occurrencesBySeries = memo(() => {
  const m = new Map();
  for (const t of state.tasks.values()) {
    if (t.kind !== 'occurrence' || !t.seriesId) continue;
    if (!m.has(t.seriesId)) m.set(t.seriesId, []);
    m.get(t.seriesId).push(t);
  }
  return m;
});

/** Actual effort for a task. For a series, includes all its occurrences. */
export function taskActual(taskId) {
  const task = get('tasks', taskId);
  const ids = [taskId];
  if (task?.kind === 'series') for (const o of occurrencesBySeries().get(taskId) || []) ids.push(o.id);
  let pomos = 0; let sec = 0; const sessions = [];
  for (const id of ids) {
    for (const s of sessionsByTask().get(id) || []) {
      sessions.push(s);
      if (isCountedFocus(s)) { pomos++; sec += s.actualDuration || 0; }
    }
  }
  sessions.sort((a, b) => (b.endTime ?? 0) - (a.endTime ?? 0) || b.date.localeCompare(a.date));
  return { pomos, sec, minutes: sec / 60, sessions };
}

/** Persist a session and move its task to in-progress if it was not started. */
export async function recordSession(fields) {
  const now = Date.now();
  const task = fields.taskId ? get('tasks', fields.taskId) : null;
  const rec = normalizeSession({
    id: fields.id || newId('s'),
    projectId: task ? task.projectId : null,
    objectiveId: task ? task.objectiveId : null,
    ...fields,
    taskId: task ? task.id : null,
    createdAt: now,
    updatedAt: now,
  }, now);
  const put = { sessions: [rec] };
  if (task && rec.type === 'focus' && rec.completed && (task.status === 'inbox' || task.status === 'planned')) {
    put.tasks = [{ ...task, status: 'in-progress', startedAt: task.startedAt ?? rec.startTime ?? now, updatedAt: now }];
  }
  await commit({ put });
  return rec;
}

export async function logManualSession({ type = 'focus', date, startTime = null, durationMin, taskId = null, notes = '' }) {
  const sec = Math.round(Number(durationMin) * 60);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error('Duration must be more than 0 minutes');
  const start = startTime ?? null;
  return recordSession({
    type, taskId, date: date || (start ? keyFromTs(start) : null),
    startTime: start, endTime: start ? start + sec * 1000 : null,
    plannedDuration: null, actualDuration: sec, completed: true,
    source: 'manual', durationSource: 'manual', notes,
  });
}

export async function updateSession(id, patch) {
  const cur = get('sessions', id);
  if (!cur) throw new Error('Session not found');
  const next = { ...cur, ...patch, id, updatedAt: Date.now() };
  if (patch.taskId !== undefined) {
    const task = patch.taskId ? get('tasks', patch.taskId) : null;
    next.taskId = task ? task.id : null;
    next.projectId = task ? task.projectId : (patch.projectId ?? cur.projectId);
    next.objectiveId = task ? task.objectiveId : null;
  }
  if (patch.startTime !== undefined && patch.startTime && next.actualDuration) {
    next.endTime = patch.startTime + next.actualDuration * 1000;
    next.date = keyFromTs(patch.startTime);
  }
  const rec = normalizeSession(next);
  await commit({ put: { sessions: [rec] } });
  return rec;
}

export function assignSession(id, taskId) { return updateSession(id, { taskId }); }

export async function deleteSessions(ids) {
  return commit({ del: { sessions: ids } });
}

export function sessionLabel(s) {
  if (s.type === 'shortBreak') return 'Short break';
  if (s.type === 'longBreak') return 'Long break';
  return s.completed ? 'Focus' : 'Focus (stopped early)';
}

export function allSessions() { return all('sessions'); }
