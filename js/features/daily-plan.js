/**
 * Daily plans.
 *
 * A plan is keyed by its local date. It owns:
 *   - the Day Win (dayWinTaskId) — stored once per date, so two Day Wins on
 *     the same day are impossible by construction
 *   - the day's chosen objectives and habits
 *   - a snapshot taken when the user saves the plan, so a later review can
 *     compare what was planned with what actually happened even after tasks
 *     are edited or re-estimated
 *
 * Which tasks belong to a day is NOT duplicated here: task.plannedDate is the
 * single source of truth.
 */
import { state, get, commit } from '../core/state.js';
import { normalizePlan, ValidationError } from '../utils/validation.js';
import { todayKey } from '../utils/dates.js';
import { tasksOn } from './tasks.js';
import { taskActual } from './sessions.js';
import { focusTargetMinutes } from './settings.js';
import { scheduledHabits } from './habits.js';

export function getPlan(date) {
  return state.dailyPlans.get(date) || {
    id: date, date, objectiveIds: [], habitIds: null, dayWinTaskId: null, dayWinHistory: [],
    focusTargetMin: null, intention: '', saved: false, savedAt: null, snapshot: null, virtual: true,
  };
}

async function writePlan(date, patch) {
  const now = Date.now();
  const cur = getPlan(date);
  const { virtual, ...base } = cur;
  const rec = normalizePlan({ ...base, ...patch, id: date, date, createdAt: cur.createdAt ?? now, updatedAt: now }, now);
  await commit({ put: { dailyPlans: [rec] } });
  return rec;
}

export const updatePlan = (date, patch) => writePlan(date, patch);

// ---------- Day Win ----------
/**
 * Make `taskId` the Day Win for `date`. The task must be planned on that day.
 * Returns { previous } so the UI can mention what was replaced.
 */
export async function setDayWin(date, taskId) {
  const task = get('tasks', taskId);
  if (!task) throw new ValidationError('Task not found');
  if (task.kind === 'series') throw new ValidationError('A repeating series cannot be a Day Win — choose one of its days instead.');
  if (task.plannedDate !== date) throw new ValidationError('The Day Win must be a task planned for that day.');
  const plan = getPlan(date);
  const previous = plan.dayWinTaskId && plan.dayWinTaskId !== taskId ? get('tasks', plan.dayWinTaskId) : null;
  if (plan.dayWinTaskId === taskId) return { previous: null, plan };
  const now = Date.now();
  const history = [...(plan.dayWinHistory || [])];
  if (previous) history.push({ taskId: previous.id, title: previous.title, action: 'replaced', at: now });
  history.push({ taskId, title: task.title, action: 'set', at: now });
  const rec = await writePlan(date, { dayWinTaskId: taskId, dayWinHistory: history });
  return { previous, plan: rec };
}

export async function clearDayWin(date) {
  const plan = getPlan(date);
  if (!plan.dayWinTaskId) return;
  const t = get('tasks', plan.dayWinTaskId);
  const history = [...(plan.dayWinHistory || []), { taskId: plan.dayWinTaskId, title: t?.title ?? '', action: 'cleared', at: Date.now() }];
  await writePlan(date, { dayWinTaskId: null, dayWinHistory: history });
}

export function dayWinTask(date) {
  const id = getPlan(date).dayWinTaskId;
  return id ? get('tasks', id) || null : null;
}

/** Neutral Day Win state for a date. */
export function dayWinStatus(date, today = todayKey()) {
  const task = dayWinTask(date);
  if (!task) return { key: 'none', label: 'No Day Win set', task: null };
  const actual = taskActual(task.id).pomos;
  const base = { task, actual, estimate: task.estimate };
  if (task.status === 'completed' && task.completedDate && task.completedDate <= date) return { ...base, key: 'completed', label: 'Completed' };
  if (task.status === 'completed') return { ...base, key: 'completed-later', label: `Completed later (${task.completedDate})` };
  if (task.plannedDate !== date) return { ...base, key: 'moved', label: task.plannedDate ? `Not completed, moved to ${task.plannedDate}` : 'Not completed, unscheduled' };
  if (date < today) return { ...base, key: 'not-completed', label: 'Not completed' };
  return { ...base, key: 'open', label: 'In progress' };
}

export function isDayWin(taskId, date) {
  return !!date && getPlan(date).dayWinTaskId === taskId;
}

/** Dates on which a task is/was the Day Win. */
export function dayWinDatesFor(taskId) {
  const out = [];
  for (const p of state.dailyPlans.values()) if (p.dayWinTaskId === taskId) out.push(p.date);
  return out.sort();
}

// ---------- objectives & habits for a day ----------
export function planObjectiveIds(date) {
  const ids = new Set(getPlan(date).objectiveIds);
  for (const t of tasksOn(date)) if (t.objectiveId) ids.add(t.objectiveId);
  return [...ids].filter((id) => get('objectives', id));
}

export async function toggleObjectiveForDay(date, objectiveId) {
  const plan = getPlan(date);
  const ids = plan.objectiveIds.includes(objectiveId)
    ? plan.objectiveIds.filter((x) => x !== objectiveId) : [...plan.objectiveIds, objectiveId];
  return writePlan(date, { objectiveIds: ids });
}

/** Habits shown on a day: an explicit plan selection, else the habit schedule. */
export function habitIdsFor(date) {
  const plan = getPlan(date);
  if (Array.isArray(plan.habitIds)) return plan.habitIds.filter((id) => get('habits', id));
  return scheduledHabits(date).map((h) => h.id);
}

export async function setHabitIncluded(date, habitId, included) {
  const ids = new Set(habitIdsFor(date));
  if (included) ids.add(habitId); else ids.delete(habitId);
  return writePlan(date, { habitIds: [...ids] });
}

// ---------- workload & snapshot ----------
export function workload(date, settings = state.settings) {
  const tasks = tasksOn(date);
  const focusMin = settings.timer.focusMin;
  let plannedPomos = 0; let remainingPomos = 0; let unestimated = 0; let high = 0;
  for (const t of tasks) {
    if (t.priority === 'high' && t.status !== 'completed') high++;
    if (t.estimate == null) { unestimated++; continue; }
    plannedPomos += t.estimate;
    if (t.status !== 'completed') remainingPomos += Math.max(0, t.estimate - taskActual(t.id).pomos);
  }
  const plan = getPlan(date);
  const targetMin = plan.focusTargetMin ?? focusTargetMinutes(settings);
  const plannedFocusMin = plannedPomos * focusMin;
  const ratio = targetMin > 0 ? plannedFocusMin / targetMin : 0;
  const { workloadLightPct: light, workloadHeavyPct: heavy } = settings.goals;
  const level = plannedPomos === 0 ? 'empty' : ratio * 100 < light ? 'light' : ratio * 100 <= heavy ? 'moderate' : 'heavy';
  const habitMin = habitIdsFor(date).reduce((s, id) => s + (get('habits', id)?.estimateMin || 0), 0);
  return {
    tasks: tasks.length, open: tasks.filter((t) => t.status !== 'completed').length, plannedPomos, remainingPomos,
    plannedFocusMin, remainingFocusMin: remainingPomos * focusMin, targetMin, ratio, level, unestimated, high, habitMin,
  };
}

export const WORKLOAD_LABEL = { empty: 'Nothing estimated', light: 'Light', moderate: 'Moderate', heavy: 'Heavy' };

/** Save the plan and freeze a snapshot of what was planned. */
export async function savePlan(date, patch = {}) {
  const tasks = tasksOn(date);
  const w = workload(date);
  const now = Date.now();
  const snapshot = {
    savedAt: now,
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, estimate: t.estimate, objectiveId: t.objectiveId, projectId: t.projectId, priority: t.priority })),
    plannedPomos: w.plannedPomos,
    plannedFocusMin: w.plannedFocusMin,
    targetMin: w.targetMin,
    objectiveIds: planObjectiveIds(date),
    habitIds: habitIdsFor(date),
    dayWinTaskId: getPlan(date).dayWinTaskId,
  };
  return writePlan(date, { ...patch, saved: true, savedAt: now, snapshot, habitIds: habitIdsFor(date) });
}
