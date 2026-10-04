/**
 * Custom streaks.
 *
 * A streak definition says WHAT must happen (metric + threshold) and WHEN it
 * matters (daily on chosen weekdays, or weekly). Results are computed from the
 * day-level data in analytics.js — nothing is counted incrementally, so a
 * streak can never drift from the history it describes.
 *
 * Daily:  consecutive active days on which the condition held. Days outside
 *         activeDays are skipped (they neither extend nor break the streak).
 *         Today only counts once met; an unfinished today never breaks it.
 * Weekly: numeric metrics sum over the week's active days and must reach the
 *         threshold; yes/no metrics need at least one qualifying day.
 */
import { all, get, commit, memo, state } from '../core/state.js';
import { normalizeStreak } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { todayKey, addDays, weekday, startOfWeek, rangeKeys } from '../utils/dates.js';
import { STREAK_METRICS } from '../core/constants.js';
import { focusOn, completionsOn, objectivesOn, firstDataDate } from './analytics.js';
import { dayWinStatus } from './daily-plan.js';
import { isDone as habitDone, isScheduled } from './habits.js';

export function listStreaks({ enabledOnly = false } = {}) {
  return all('streaks').filter((s) => !enabledOnly || s.enabled).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** Raw metric value for a day; null = not applicable that day (neutral). */
export function metricValue(streak, date) {
  switch (streak.metric) {
    case 'pomodoros': return focusOn(date).pomos;
    case 'focusMinutes': return Math.round(focusOn(date).min);
    case 'tasksCompleted': return completionsOn(date).length;
    case 'objectivePct': {
      const o = objectivesOn(date);
      return o.total ? Math.round((o.done / o.total) * 100) : 0;
    }
    case 'dayWin': return dayWinStatus(date).key === 'completed' ? 1 : 0;
    case 'habit': {
      const h = get('habits', streak.habitIds[0]);
      if (!h) return null;
      if (!isScheduled(h, date)) return null;
      return habitDone(h.id, date) ? 1 : 0;
    }
    case 'habitGroup': {
      const hs = streak.habitIds.map((id) => get('habits', id)).filter(Boolean).filter((h) => isScheduled(h, date));
      if (!hs.length) return null;
      return hs.every((h) => habitDone(h.id, date)) ? 1 : 0;
    }
    default: return null;
  }
}

const isBoolean = (s) => !STREAK_METRICS[s.metric]?.needsThreshold;

export function dayMet(streak, date) {
  if (!streak.activeDays.includes(weekday(date))) return null;
  const v = metricValue(streak, date);
  if (v == null) return null;
  return isBoolean(streak) ? v >= 1 : v >= streak.threshold;
}

function weekResult(streak, weekStartKey, today) {
  const keys = rangeKeys(weekStartKey, addDays(weekStartKey, 6)).filter((k) => k <= today && streak.activeDays.includes(weekday(k)));
  if (!keys.length) return { met: null, value: 0 };
  if (isBoolean(streak)) {
    const vals = keys.map((k) => metricValue(streak, k)).filter((v) => v != null);
    if (!vals.length) return { met: null, value: 0 };
    const n = vals.filter((v) => v >= 1).length;
    return { met: n >= 1, value: n };
  }
  if (streak.metric === 'objectivePct') {
    const vals = keys.map((k) => (objectivesOn(k).total ? metricValue(streak, k) : null)).filter((v) => v != null);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { met: avg >= streak.threshold, value: Math.round(avg) };
  }
  const sum = keys.reduce((s, k) => s + (metricValue(streak, k) || 0), 0);
  return { met: sum >= streak.threshold, value: sum };
}

/**
 * Evaluate a streak: { current, longest, unit, todayMet, periods: [{key, met, value, run}] }
 * periods are oldest → newest and include the running length (for charts).
 */
export const evaluateStreak = memo((id, today = todayKey()) => {
  const streak = get('streaks', id);
  if (!streak) return null;
  const start = firstDataDate();
  const periods = [];
  if (streak.frequency === 'weekly') {
    const ws = state.settings.general.weekStart;
    let wk = startOfWeek(start, ws);
    const cur = startOfWeek(today, ws);
    let guard = 0;
    while (wk <= cur && guard++ < 600) {
      const r = weekResult(streak, wk, today);
      periods.push({ key: wk, ...r, pending: wk === cur && !r.met });
      wk = addDays(wk, 7);
    }
  } else {
    for (const k of rangeKeys(start, today)) {
      const met = dayMet(streak, k);
      const v = met == null ? null : metricValue(streak, k);
      periods.push({ key: k, met, value: v, pending: k === today && met === false });
    }
  }
  // running length, skipping neutral periods
  let run = 0; let longest = 0;
  for (const p of periods) {
    if (p.met === true) run++;
    else if (p.met === false && !p.pending) run = 0;
    p.run = run;
    longest = Math.max(longest, run);
  }
  let current = 0;
  for (let i = periods.length - 1; i >= 0; i--) {
    const p = periods[i];
    if (p.met === true) current++;
    else if (p.met === null || p.pending) continue;
    else break;
  }
  const last = periods[periods.length - 1];
  return {
    streak, current, longest, unit: streak.frequency === 'weekly' ? 'week' : 'day',
    todayMet: last ? last.met : null, todayValue: last ? last.value : null, pending: !!last?.pending, periods,
  };
});

export function describeStreak(s) {
  const spec = STREAK_METRICS[s.metric];
  const per = s.frequency === 'weekly' ? 'per week' : 'per day';
  let what;
  switch (s.metric) {
    case 'pomodoros': what = `At least ${s.threshold} Pomodoro${s.threshold === 1 ? '' : 's'} ${per}`; break;
    case 'focusMinutes': what = `At least ${s.threshold} focus minutes ${per}`; break;
    case 'tasksCompleted': what = `At least ${s.threshold} task${s.threshold === 1 ? '' : 's'} completed ${per}`; break;
    case 'objectivePct': what = `${s.threshold}%+ of the day's objectives completed${s.frequency === 'weekly' ? ' (weekly average)' : ''}`; break;
    case 'dayWin': what = s.frequency === 'weekly' ? 'Day Win completed at least once a week' : 'Day Win completed'; break;
    case 'habit': what = `${get('habits', s.habitIds[0])?.name || 'Habit'} done${s.frequency === 'weekly' ? ' at least once a week' : ' on scheduled days'}`; break;
    case 'habitGroup': what = `All of ${s.habitIds.map((id) => get('habits', id)?.name).filter(Boolean).join(', ') || 'the chosen habits'} done`; break;
    default: what = spec?.label || s.metric;
  }
  const allDays = s.activeDays.length === 7;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = allDays ? '' : s.activeDays.length === 5 && [1, 2, 3, 4, 5].every((d) => s.activeDays.includes(d)) ? 'weekdays' : s.activeDays.map((d) => names[d]).join(', ');
  return days ? `${what}, ${days}` : what;
}

export async function createStreak(fields) {
  const now = Date.now();
  const maxOrder = Math.max(0, ...all('streaks').map((s) => s.order ?? 0));
  const rec = normalizeStreak({ ...fields, id: newId('k'), order: maxOrder + 1024, createdAt: now, updatedAt: now }, now);
  await commit({ put: { streaks: [rec] } });
  return rec;
}

export async function updateStreak(id, patch) {
  const cur = get('streaks', id);
  if (!cur) throw new Error('Streak not found');
  const rec = normalizeStreak({ ...cur, ...patch, id, updatedAt: Date.now() });
  await commit({ put: { streaks: [rec] } });
  return rec;
}

export const toggleStreak = (id) => updateStreak(id, { enabled: !get('streaks', id)?.enabled });

export async function deleteStreak(id) {
  return commit({ del: { streaks: [id] } });
}

/** Default streaks for a brand-new install (deterministic IDs → never duplicated). */
export async function ensureDefaultStreaks() {
  if (all('streaks').length) return;
  const now = Date.now();
  await commit({
    put: {
      streaks: [
        normalizeStreak({ id: 'k_default_focus', name: 'Daily focus', metric: 'pomodoros', threshold: 1, frequency: 'daily', order: 1024, createdAt: now, updatedAt: now }),
        normalizeStreak({ id: 'k_default_daywin', name: 'Day Win', metric: 'dayWin', frequency: 'daily', order: 2048, createdAt: now, updatedAt: now }),
      ],
    },
  }, { silent: true });
}
