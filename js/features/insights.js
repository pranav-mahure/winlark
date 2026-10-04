/**
 * Planning assistant — deterministic, local, and descriptive.
 *
 * Each insight is a plain observation computed from the user's own data plus
 * optional suggested actions. Actions are only descriptors; the UI asks for
 * confirmation before anything in the plan changes. Nothing here rearranges
 * a plan on its own.
 */
import { state, get } from '../core/state.js';
import { addDays, todayKey, formatKey, relativeLabel } from '../utils/dates.js';
import { fmtDuration, fmtPct } from '../utils/format.js';
import { tasksOn, overdueOpen, isOpen, blockingTasks } from './tasks.js';
import { workload, getPlan } from './daily-plan.js';
import { plannedVsActual, focusOn } from './analytics.js';
import { taskActual } from './sessions.js';

const PRI = { high: 0, med: 1, low: 2 };

/** Pick the open task that is easiest to move (lowest priority, latest in order, not the Day Win). */
function moveCandidate(date) {
  const winId = getPlan(date).dayWinTaskId;
  const open = tasksOn(date).filter((t) => isOpen(t) && t.id !== winId && taskActual(t.id).pomos === 0);
  open.sort((a, b) => PRI[b.priority] - PRI[a.priority] || (b.order ?? 0) - (a.order ?? 0));
  return open[0] || null;
}

export function planInsights(date, today = todayKey()) {
  const out = [];
  const w = workload(date);
  const tasks = tasksOn(date);
  const plan = getPlan(date);
  const label = relativeLabel(date, today);
  const focusMin = state.settings.timer.focusMin;

  if (w.plannedPomos > 0) {
    const msg = `${label} has ${w.plannedPomos} Pomodoro${w.plannedPomos === 1 ? '' : 's'} planned (${fmtDuration(w.plannedFocusMin)} of focus) against a target of ${fmtDuration(w.targetMin)}.`;
    if (w.level === 'heavy') {
      const c = moveCandidate(date);
      out.push({
        id: 'workload', tone: 'attention', text: msg,
        detail: c ? `Moving “${c.title}” (${c.estimate ?? 0} Pomodoros, ${c.priority === 'low' ? 'low' : c.priority === 'med' ? 'medium' : 'high'} priority) would bring it to ${fmtDuration(w.plannedFocusMin - (c.estimate || 0) * focusMin)}.` : '',
        actions: c ? [
          { label: `Move “${trim(c.title)}” to ${formatKey(addDays(date, 1), { weekday: 'short' })}`, action: 'insight-move', taskId: c.id, to: addDays(date, 1) },
          { label: 'Choose a day…', action: 'task-move', id: c.id },
        ] : [],
      });
    } else {
      out.push({ id: 'workload', tone: 'info', text: msg, actions: [] });
    }
  }

  if (tasks.length && !plan.dayWinTaskId && date >= today) {
    out.push({
      id: 'no-daywin', tone: 'info', text: 'No Day Win is set yet. Choosing one task that would make the day a win keeps the plan focused.',
      actions: [{ label: 'Choose a Day Win', action: 'daywin-pick', date }],
    });
  }
  if (plan.dayWinTaskId) {
    const open = tasks.filter((t) => t.status !== 'completed');
    const idx = open.findIndex((t) => t.id === plan.dayWinTaskId);
    if (idx > 0) {
      out.push({
        id: 'daywin-top', tone: 'info', text: `The Day Win is #${idx + 1} in the task order. Putting it first makes it the natural next task.`,
        actions: [{ label: 'Move Day Win to the top', action: 'daywin-top', date }],
      });
    }
  }

  if (w.high >= 3) {
    out.push({ id: 'high', tone: 'info', text: `${w.high} high-priority tasks are scheduled. If everything is high priority, the order matters more than the label.`, actions: [] });
  }
  if (w.unestimated > 0) {
    const first = tasks.find((t) => t.estimate == null && t.status !== 'completed');
    out.push({
      id: 'unestimated', tone: 'info', text: `${w.unestimated} task${w.unestimated === 1 ? ' has' : 's have'} no Pomodoro estimate, so the workload above leaves ${w.unestimated === 1 ? 'it' : 'them'} out.`,
      actions: first ? [{ label: 'Add an estimate', action: 'task-edit', id: first.id }] : [],
    });
  }

  // Estimation bias for projects on this day (needs ≥3 finished, reliable estimates).
  const projects = [...new Set(tasks.map((t) => t.projectId).filter(Boolean))];
  if (projects.length) {
    const pva = plannedVsActual({});
    for (const g of pva.byProject) {
      if (!projects.includes(g.key) || g.count < 3) continue;
      const diff = g.ratio - 1;
      if (Math.abs(diff) < 0.15) continue;
      const name = get('projects', g.key)?.name || 'this project';
      out.push({
        id: `bias-${g.key}`, tone: 'info',
        text: diff > 0
          ? `On finished ${name} tasks you have spent about ${fmtPct(diff)} more Pomodoros than estimated (${g.actual} actual vs ${g.planned} planned across ${g.count} tasks).`
          : `On finished ${name} tasks you have needed about ${fmtPct(-diff)} fewer Pomodoros than estimated (${g.actual} actual vs ${g.planned} planned across ${g.count} tasks).`,
        actions: [{ label: 'Review estimates', action: 'nav', to: '#/analytics/planning' }],
      });
    }
  }

  // Dependencies scheduled after their dependents.
  for (const t of tasks) {
    for (const dep of blockingTasks(t)) {
      if (dep.plannedDate && dep.plannedDate > date) {
        out.push({
          id: `dep-${t.id}`, tone: 'attention',
          text: `“${trim(t.title)}” depends on “${trim(dep.title)}”, which is planned for ${formatKey(dep.plannedDate)}.`,
          actions: [{ label: 'Open task', action: 'task-open', id: t.id }],
        });
      }
    }
  }

  if (date >= today) {
    const overdue = overdueOpen(today);
    if (overdue.length) {
      out.push({
        id: 'overdue', tone: 'info',
        text: `${overdue.length} unfinished task${overdue.length === 1 ? '' : 's'} from earlier days ${overdue.length === 1 ? 'is' : 'are'} still open. They stay on their original days until you move them.`,
        actions: [{ label: 'Review them', action: 'nav', to: '#/tasks?when=overdue' }],
      });
    }
  }

  // Typical recent output on planned days (descriptive only).
  if (w.plannedPomos > 0) {
    let days = 0; let pomos = 0;
    for (let i = 1; i <= 28; i++) {
      const k = addDays(today, -i);
      const f = focusOn(k);
      if (f.pomos > 0) { days++; pomos += f.pomos; }
    }
    if (days >= 5) {
      const avg = pomos / days;
      if (w.plannedPomos > avg * 1.4) {
        out.push({ id: 'history', tone: 'info', text: `Over the last 4 weeks you averaged ${avg.toFixed(1)} Pomodoros on days you focused; this plan has ${w.plannedPomos}.`, actions: [] });
      }
    }
  }
  return out;
}

function trim(s, n = 32) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
