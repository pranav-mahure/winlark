/** Calendar: month grid enriched with per-day activity. */
import { state } from '../core/state.js';
import { monthGrid, todayKey } from '../utils/dates.js';
import { focusOn, dayTasks, habitsOn, completionsOn, heatmapData } from './analytics.js';
import { dayWinStatus, getPlan } from './daily-plan.js';
import { tasksOn } from './tasks.js';

export function monthData(year, monthIndex, today = todayKey()) {
  const weekStart = state.settings.general.weekStart;
  const keys = monthGrid(year, monthIndex, weekStart);
  const prefix = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  // intensity relative to the whole visible grid
  const heat = heatmapData(keys[0], keys[keys.length - 1]);
  const levels = new Map(heat.days.map((d) => [d.date, d.level]));
  return keys.map((date) => {
    const f = focusOn(date);
    const isPastOrToday = date <= today;
    const t = isPastOrToday ? dayTasks(date) : { total: tasksOn(date).length, completed: 0 };
    const h = habitsOn(date);
    const plan = getPlan(date);
    return {
      date,
      inMonth: date.startsWith(prefix),
      isToday: date === today,
      isFuture: date > today,
      pomos: f.pomos,
      focusMin: f.min,
      level: levels.get(date) || 0,
      tasksPlanned: t.total,
      tasksDone: t.completed,
      completions: completionsOn(date).length,
      dayWin: plan.dayWinTaskId ? dayWinStatus(date, today).key : 'none',
      habitsDone: h.done,
      habitsTotal: isPastOrToday ? h.total : 0,
      hasReview: state.reviews.has(date),
      hasPlan: !!plan.saved,
    };
  });
}
