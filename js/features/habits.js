/**
 * Habits — lightweight routines, deliberately separate from tasks.
 * A completion is one record per habit per date (id = habitId@date), so
 * toggling twice can never create duplicates.
 */
import { state, all, get, commit } from '../core/state.js';
import { normalizeHabit, normalizeHabitCompletion } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { todayKey, addDays, weekday, keyFromTs, rangeKeys } from '../utils/dates.js';

export function listHabits({ includeInactive = true } = {}) {
  return all('habits').filter((h) => includeInactive || h.active).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function habitStart(h) { return h.startDate || keyFromTs(h.createdAt || Date.now()); }

export function isScheduled(h, date) {
  if (!h.active) return false;
  if (date < habitStart(h)) return false;
  return h.schedule.type === 'daily' || h.schedule.days.includes(weekday(date));
}

export function scheduledHabits(date) {
  return listHabits({ includeInactive: false }).filter((h) => isScheduled(h, date));
}

export function isDone(habitId, date) { return state.habitCompletions.has(`${habitId}@${date}`); }

export async function setHabitDone(habitId, date, done) {
  const id = `${habitId}@${date}`;
  if (done) {
    if (state.habitCompletions.has(id)) return;
    const now = Date.now();
    await commit({ put: { habitCompletions: [normalizeHabitCompletion({ habitId, date, completedAt: now, createdAt: now }, now)] } });
  } else {
    if (!state.habitCompletions.has(id)) return;
    await commit({ del: { habitCompletions: [id] } });
  }
}

export const toggleHabit = (habitId, date) => setHabitDone(habitId, date, !isDone(habitId, date));

/**
 * Streak over scheduled days only. Today counts if done, but an unfinished
 * today never breaks the streak (the day is not over).
 */
export function habitStreak(h, today = todayKey()) {
  const start = habitStart(h);
  let current = 0;
  let d = today;
  let guard = 0;
  if (isScheduled(h, d) && !isDone(h.id, d)) d = addDays(d, -1);
  while (d >= start && guard++ < 3660) {
    if (h.schedule.type === 'daily' || h.schedule.days.includes(weekday(d))) {
      if (isDone(h.id, d)) current++; else break;
    }
    d = addDays(d, -1);
  }
  let longest = 0; let run = 0;
  for (const k of rangeKeys(start, today)) {
    if (!(h.schedule.type === 'daily' || h.schedule.days.includes(weekday(k)))) continue;
    if (isDone(h.id, k)) { run++; longest = Math.max(longest, run); } else if (k !== today) run = 0;
  }
  return { current, longest: Math.max(longest, current) };
}

export function habitRate(h, start, end) {
  let scheduled = 0; let done = 0;
  const s = start < habitStart(h) ? habitStart(h) : start;
  for (const k of rangeKeys(s, end)) {
    if (h.schedule.type === 'daily' || h.schedule.days.includes(weekday(k))) {
      scheduled++;
      if (isDone(h.id, k)) done++;
    }
  }
  return { scheduled, done, ratio: scheduled ? done / scheduled : 0 };
}

export function habitHistory(h, days = 28, today = todayKey()) {
  return rangeKeys(addDays(today, -(days - 1)), today).map((date) => ({
    date,
    scheduled: date >= habitStart(h) && (h.schedule.type === 'daily' || h.schedule.days.includes(weekday(date))),
    done: isDone(h.id, date),
  }));
}

export async function createHabit(fields) {
  const now = Date.now();
  const maxOrder = Math.max(0, ...all('habits').map((h) => h.order ?? 0));
  const rec = normalizeHabit({ ...fields, id: newId('h'), startDate: fields.startDate || todayKey(), order: maxOrder + 1024, createdAt: now, updatedAt: now }, now);
  await commit({ put: { habits: [rec] } });
  return rec;
}

export async function updateHabit(id, patch) {
  const cur = get('habits', id);
  if (!cur) throw new Error('Habit not found');
  const rec = normalizeHabit({ ...cur, ...patch, id, updatedAt: Date.now() });
  await commit({ put: { habits: [rec] } });
  return rec;
}

/** Deletes the habit and its completions. Returns inverse for Undo. */
export async function deleteHabit(id) {
  const completions = all('habitCompletions').filter((c) => c.habitId === id).map((c) => c.id);
  const now = Date.now();
  const streaks = all('streaks').filter((s) => s.habitIds?.includes(id))
    .map((s) => ({ ...s, habitIds: s.habitIds.filter((x) => x !== id), enabled: s.habitIds.length > 1 ? s.enabled : false, updatedAt: now }));
  const plans = all('dailyPlans').filter((p) => p.habitIds?.includes(id))
    .map((p) => ({ ...p, habitIds: p.habitIds.filter((x) => x !== id), updatedAt: now }));
  return commit({ put: { streaks, dailyPlans: plans }, del: { habits: [id], habitCompletions: completions } });
}

export function describeSchedule(h) {
  if (h.schedule.type === 'daily') return 'Every day';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = h.schedule.days;
  if (d.length === 5 && [1, 2, 3, 4, 5].every((x) => d.includes(x))) return 'Weekdays';
  if (d.length === 2 && d.includes(0) && d.includes(6)) return 'Weekends';
  return d.map((x) => names[x]).join(', ');
}
