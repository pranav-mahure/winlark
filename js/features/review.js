/**
 * Daily review: what was planned, what actually happened, and the user's own
 * reflections. Deliberately no score — only transparent facts.
 */
import { state, get, commit, all } from '../core/state.js';
import { normalizeReview } from '../utils/validation.js';
import { todayKey } from '../utils/dates.js';
import { isCountedFocus } from './sessions.js';
import { getPlan, dayWinStatus } from './daily-plan.js';
import { dayTasks, focusOn, habitsOn, objectivesOn, completionsOn, dailyPlanVsActual } from './analytics.js';
import { taskActual } from './sessions.js';

export function getReview(date) {
  return state.reviews.get(date) || null;
}

export async function saveReview(date, patch) {
  const cur = getReview(date);
  const now = Date.now();
  const rec = normalizeReview({ ...(cur || {}), ...patch, id: date, date, createdAt: cur?.createdAt ?? now, updatedAt: now }, now);
  await commit({ put: { reviews: [rec] } });
  return rec;
}

export async function deleteReview(date) {
  return commit({ del: { reviews: [date] } });
}

/** Full picture of a day for the review screen, calendar and day details. */
export function dayReview(date, today = todayKey()) {
  const plan = getPlan(date);
  const tasks = dayTasks(date);
  const focus = focusOn(date);
  const pva = dailyPlanVsActual(date, date)[0];
  const sessions = all('sessions').filter((s) => s.date === date)
    .sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity));
  const focusSessions = sessions.filter(isCountedFocus);
  const projects = new Map();
  for (const s of focusSessions) {
    const k = s.projectId || '_none';
    const p = projects.get(k) || { projectId: s.projectId, pomos: 0, min: 0 };
    p.pomos++; p.min += (s.actualDuration || 0) / 60;
    projects.set(k, p);
  }
  const plannedRows = tasks.planned.map((t) => {
    const daySessions = taskActual(t.id).sessions.filter((s) => isCountedFocus(s) && s.date === date).length;
    const snap = plan.snapshot?.tasks?.find((x) => x.id === t.id);
    return { task: t, snapshotEstimate: snap ? snap.estimate : undefined, pomosThatDay: daySessions, doneOnTime: tasks.doneOnTime(t) };
  });
  const snapshotIds = new Set(plan.snapshot?.tasks?.map((x) => x.id) || []);
  const currentIds = new Set([...tasks.planned, ...tasks.moved].map((t) => t.id));
  const addedAfterSave = plan.snapshot ? tasks.planned.filter((t) => !snapshotIds.has(t.id)) : [];
  const removedAfterSave = plan.snapshot ? plan.snapshot.tasks.filter((x) => !currentIds.has(x.id)) : [];
  return {
    date,
    isPast: date < today,
    isToday: date === today,
    plan,
    focus: { plannedMin: pva.plannedMin, plannedSource: pva.source, actualMin: focus.min, pomos: focus.pomos },
    tasks: { planned: plannedRows, moved: tasks.moved, total: tasks.total, completed: tasks.completed, addedAfterSave, removedAfterSave },
    completions: completionsOn(date),
    objectives: objectivesOn(date),
    habits: habitsOn(date),
    dayWin: dayWinStatus(date, today),
    projects: [...projects.values()].map((p) => ({ ...p, name: p.projectId ? get('projects', p.projectId)?.name || 'Deleted project' : 'No project', color: p.projectId ? get('projects', p.projectId)?.color : null })).sort((a, b) => b.min - a.min),
    sessions,
    review: getReview(date),
  };
}
