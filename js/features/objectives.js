/**
 * Objectives: meaningful outcomes that span tasks and days.
 * Progress is derived from child tasks — never stored — so it cannot drift.
 */
import { all, get, commit, memo } from '../core/state.js';
import { normalizeObjective } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { todayKey } from '../utils/dates.js';
import { taskActual } from './sessions.js';
import { byOrder } from './tasks.js';

export function listObjectives({ status = null, projectId = null } = {}) {
  return all('objectives')
    .filter((o) => (!status || (Array.isArray(status) ? status.includes(o.status) : o.status === status)))
    .filter((o) => (projectId ? o.projectId === projectId : true))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export const activeObjectives = () => listObjectives({ status: 'active' });

export function objectiveTasks(id) {
  return all('tasks').filter((t) => t.objectiveId === id && t.kind !== 'series').sort(byOrder);
}

export const objectiveProgress = memo((id) => {
  const tasks = objectiveTasks(id).filter((t) => t.status !== 'archived');
  const done = tasks.filter((t) => t.status === 'completed').length;
  let planned = 0; let actual = 0; let sec = 0; let estimated = 0;
  for (const t of tasks) {
    if (t.estimate != null) { planned += t.estimate; estimated++; }
    const a = taskActual(t.id); actual += a.pomos; sec += a.sec;
  }
  const days = new Set(tasks.map((t) => t.plannedDate).filter(Boolean));
  const activeDays = new Set();
  for (const t of tasks) for (const s of taskActual(t.id).sessions) if (s.type === 'focus' && s.completed) activeDays.add(s.date);
  return {
    total: tasks.length, done, ratio: tasks.length ? done / tasks.length : 0,
    plannedPomos: planned, actualPomos: actual, focusMin: sec / 60, estimated,
    plannedDays: days.size, activeDays: activeDays.size,
  };
});

export async function createObjective(fields) {
  const now = Date.now();
  const maxOrder = Math.max(0, ...all('objectives').map((o) => o.order ?? 0));
  const rec = normalizeObjective({ ...fields, id: newId('o'), order: maxOrder + 1024, createdAt: now, updatedAt: now }, now);
  await commit({ put: { objectives: [rec] } });
  return rec;
}

export async function updateObjective(id, patch) {
  const cur = get('objectives', id);
  if (!cur) throw new Error('Objective not found');
  const now = Date.now();
  const next = { ...cur, ...patch, id, updatedAt: now };
  if (patch.status === 'completed' && cur.status !== 'completed') { next.completedAt = now; next.completedDate = todayKey(); }
  const rec = normalizeObjective(next, now);
  const put = { objectives: [rec] };
  // Project change follows through to the objective's open tasks without a project.
  if ('projectId' in patch && patch.projectId !== cur.projectId) {
    put.tasks = objectiveTasks(id).filter((t) => !t.projectId || t.projectId === cur.projectId)
      .map((t) => ({ ...t, projectId: rec.projectId, updatedAt: now }));
  }
  await commit({ put });
  return rec;
}

export const setObjectiveStatus = (id, status) => updateObjective(id, { status });

/** Delete an objective; its tasks are kept and unlinked. Returns inverse for Undo. */
export async function deleteObjective(id) {
  const now = Date.now();
  const tasks = all('tasks').filter((t) => t.objectiveId === id).map((t) => ({ ...t, objectiveId: null, updatedAt: now }));
  const sessions = all('sessions').filter((s) => s.objectiveId === id).map((s) => ({ ...s, objectiveId: null, updatedAt: now }));
  const plans = all('dailyPlans').filter((p) => p.objectiveIds.includes(id))
    .map((p) => ({ ...p, objectiveIds: p.objectiveIds.filter((x) => x !== id), updatedAt: now }));
  return commit({ put: { tasks, sessions, dailyPlans: plans }, del: { objectives: [id] } });
}

export async function setObjectiveOrder(ids) {
  const now = Date.now();
  const put = [];
  ids.forEach((id, i) => {
    const o = get('objectives', id);
    if (o && o.order !== (i + 1) * 1024) put.push({ ...o, order: (i + 1) * 1024, updatedAt: now });
  });
  if (put.length) await commit({ put: { objectives: put } });
}

/**
 * Day-level objective result for reviews: an objective counts as done for
 * the day when every task under it planned that day is completed (and there
 * was at least one), or when the objective itself was completed that day.
 */
export function objectiveDayResult(objectiveId, date) {
  const obj = get('objectives', objectiveId);
  if (!obj) return null;
  const tasks = all('tasks').filter((t) => t.objectiveId === objectiveId && t.kind !== 'series'
    && (t.plannedDate === date || t.moveHistory?.some((m) => m.from === date)));
  const onDay = tasks.filter((t) => t.plannedDate === date);
  const doneOnTime = (t) => t.status === 'completed' && t.completedDate && t.completedDate <= date;
  const done = obj.completedDate === date || (tasks.length > 0 && tasks.every((t) => t.plannedDate === date && doneOnTime(t)));
  return { objective: obj, tasks, onDay, completedTasks: onDay.filter(doneOnTime).length, done };
}
