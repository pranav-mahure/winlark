/** Analytics — Overview, Focus, Tasks, Objectives, Habits, Projects, Planning, Streaks. */
import { state, get, all, clearDerivedCaches } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { todayKey, addDays, formatKey, formatMonth, isValidKey, weekdayNames, rangeKeys, diffDays } from '../utils/dates.js';
import { fmtDuration, fmtPct, fmtNumber, fmtSigned, plural } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { stat, segmented, sectionHead, emptyState, projectOptions, options } from '../ui/components.js';
import { chart } from '../ui/charts.js';
import { registerActions } from '../ui/actions.js';
import { navigate, setQuery } from '../ui/router.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, undoToast } from '../ui/toast.js';
import {
  periodRange, shiftPeriod, summary, dailySeries, bucketSeries, focusByProject, hourDistribution, weekdayDistribution,
  heatmapData, plannedVsActual, dailyPlanVsActual, dayWinHistory, habitConsistency, objectiveStats, taskStats, firstDataDate,
} from '../features/analytics.js';
import { listStreaks, evaluateStreak, describeStreak, createStreak, updateStreak, deleteStreak, toggleStreak } from '../features/streaks.js';
import { listHabits } from '../features/habits.js';
import { STREAK_METRICS } from '../core/constants.js';

export const title = 'Analytics';
const TABS = [['overview', 'Overview'], ['focus', 'Focus'], ['tasks', 'Tasks'], ['objectives', 'Objectives'], ['habits', 'Habits'], ['projects', 'Projects'], ['planning', 'Planned vs actual'], ['streaks', 'Streaks']];
const C = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

function period(q) {
  const kind = ['week', 'month', 'year', 'custom', 'all'].includes(q.p) ? q.p : 'week';
  const today = todayKey();
  const anchor = isValidKey(q.a) ? q.a : today;
  if (kind === 'custom') {
    const from = isValidKey(q.from) ? q.from : addDays(today, -29);
    const to = isValidKey(q.to) && q.to >= from ? q.to : today;
    return { kind, anchor, start: from, end: to, label: `${formatKey(from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${formatKey(to, { month: 'short', day: 'numeric', year: 'numeric' })}` };
  }
  if (kind === 'all') return { kind, anchor, start: firstDataDate(), end: today, label: `All time (since ${formatKey(firstDataDate(), { month: 'short', day: 'numeric', year: 'numeric' })})` };
  const r = periodRange(kind, anchor);
  const label = kind === 'week' ? `${formatKey(r.start, { month: 'short', day: 'numeric' })} – ${formatKey(r.end, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : kind === 'month' ? formatMonth(+r.start.slice(0, 4), +r.start.slice(5, 7) - 1) : r.start.slice(0, 4);
  return { kind, anchor, ...r, label };
}

function timeAxis(p, series) {
  const long = rangeKeys(p.start, p.end).length > 92;
  if (!long) {
    return { labels: series.map((d) => (p.kind === 'week' ? formatKey(d.date, { weekday: 'short' }) : formatKey(d.date, { month: 'short', day: 'numeric' }))), rows: series, unit: 'day', keyLabel: (d) => formatKey(d.date) };
  }
  const by = rangeKeys(p.start, p.end).length > 400 ? 'month' : (p.kind === 'year' ? 'month' : 'week');
  const b = bucketSeries(series, by, state.settings.general.weekStart);
  return { labels: b.map((x) => (by === 'month' ? formatKey(`${x.key}-01`, { month: 'short', ...(p.kind !== 'year' ? { year: '2-digit' } : {}) }) : formatKey(x.key, { month: 'short', day: 'numeric' }))), rows: b, unit: by, keyLabel: (x) => (by === 'month' ? formatKey(`${x.key}-01`, { month: 'long', year: 'numeric' }) : `Week of ${formatKey(x.key)}`) };
}

const minFmt = (v) => fmtDuration(v, { compact: true });

function overview(p) {
  const s = summary(p.start, p.end);
  const series = dailySeries(p.start, p.end);
  const ax = timeAxis(p, series);
  const proj = focusByProject(p.start, p.end);
  const today = todayKey();
  const hmStart = addDays(today, -364);
  const hm = heatmapData(hmStart, today);
  hm.days.forEach((d) => { d.tip = `${formatKey(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}\n${fmtDuration(d.focusMin)} focus, ${d.pomos} Pomodoros`; });
  return `<div class="stat-row">
      ${stat({ label: 'Focus time', value: fmtDuration(s.focusMin) })}
      ${stat({ label: 'Pomodoros', value: fmtNumber(s.pomos) })}
      ${stat({ label: 'Active days', value: `${s.activeDays}<small>/${s.elapsedDays}</small>`, sub: s.activeDays ? `${fmtDuration(s.avgPerActiveDay)} per active day` : '' })}
      ${stat({ label: 'Tasks completed', value: fmtNumber(s.completed) })}
      ${stat({ label: 'Day Wins', value: `${s.winsDone}<small>/${s.winsSet}</small>`, sub: 'completed / set' })}
      ${s.best ? stat({ label: 'Best day', value: fmtDuration(s.best.focusMin), sub: formatKey(s.best.date) }) : ''}
    </div>
    <div class="two-col two-col--wide-left">
      <section class="card">${sectionHead('Focus time', { level: 2 })}
        ${chart({ type: 'bar', height: 220, label: 'Focus time per ' + ax.unit, labels: ax.labels, series: [{ name: 'Focus', values: ax.rows.map((d) => d.focusMin), color: 'var(--chart-1)' }], yFormat: minFmt, yUnit: 'minutes', tip: (i) => `${ax.keyLabel(ax.rows[i])}\n${fmtDuration(ax.rows[i].focusMin)} focus, ${ax.rows[i].pomos} Pomodoros`, table: { head: [ax.unit === 'day' ? 'Day' : ax.unit === 'week' ? 'Week' : 'Month', 'Focus', 'Pomodoros', 'Tasks completed'], rows: ax.rows.map((d) => [ax.keyLabel(d), fmtDuration(d.focusMin), String(d.pomos), String(d.completed)]) } })}
      </section>
      <section class="card">${sectionHead('By project', { level: 2 })}
        ${proj.length ? chart({ type: 'donut', height: 190, label: 'Focus by project', slices: proj.map((x) => ({ label: x.name, value: x.min, color: x.color, tip: `${x.name}\n${fmtDuration(x.min)}, ${x.pomos} Pomodoros` })), center: { value: fmtDuration(s.focusMin, { compact: true }), label: 'total' }, table: { head: ['Project', 'Focus', 'Pomodoros'], rows: proj.map((x) => [x.name, fmtDuration(x.min), String(x.pomos)]) } })
    + `<ul class="legend-list">${proj.slice(0, 6).map((x) => `<li><span class="legend-swatch" style="--c:${esc(x.color)}"></span>${esc(x.name)}<span class="muted">${fmtPct(s.focusMin ? x.min / s.focusMin : 0)}</span></li>`).join('')}</ul>` : '<p class="muted">No focus in this period.</p>'}
      </section>
    </div>
    <section class="card">${sectionHead('Last 12 months', { level: 2 })}
      ${chart({ type: 'heatmap', height: 140, label: 'Daily focus heatmap for the last year', days: hm.days, weekStart: state.settings.general.weekStart, weekdayNames: weekdayNames(state.settings.general.weekStart), table: null })}
      <div class="cal-legend"><span>Less</span>${[0, 1, 2, 3, 4].map((l) => `<span class="heat heat-swatch heat--${l}"></span>`).join('')}<span>More</span><span class="muted">Levels are quartiles of your own active days.</span></div>
    </section>`;
}

function focusTab(p, projectId) {
  const series = dailySeries(p.start, p.end, { projectId });
  const ax = timeAxis(p, series);
  const goal = ax.unit === 'day' ? state.settings.goals.dailyPomos : 0;
  const hours = hourDistribution(p.start, p.end, { projectId });
  const wd = weekdayDistribution(p.start, p.end, { projectId });
  const ws = state.settings.general.weekStart;
  const wdOrder = Array.from({ length: 7 }, (_, i) => wd[(i + ws) % 7]);
  const wdNames = weekdayNames(ws);
  const proj = focusByProject(p.start, p.end);
  const hasTimed = hours.hours.some((h) => h.min > 0);
  return `<section class="card">${sectionHead('Pomodoros', { level: 2 })}
      ${chart({ type: 'bar', height: 220, label: 'Pomodoros per ' + ax.unit, labels: ax.labels, series: [{ name: 'Pomodoros', values: ax.rows.map((d) => d.pomos), color: 'var(--chart-1)' }], goal: goal || null, goalLabel: `Goal ${goal}`, yFormat: (v) => fmtNumber(v), tip: (i) => `${ax.keyLabel(ax.rows[i])}\n${ax.rows[i].pomos} Pomodoros, ${fmtDuration(ax.rows[i].focusMin)}`, table: { head: ['Period', 'Pomodoros', 'Focus'], rows: ax.rows.map((d) => [ax.keyLabel(d), String(d.pomos), fmtDuration(d.focusMin)]) } })}
    </section>
    <div class="two-col">
      <section class="card">${sectionHead('Time of day', { level: 2 })}
        ${hasTimed ? chart({ type: 'bar', height: 190, label: 'Focus minutes by hour of day', labels: hours.hours.map((h) => `${String(h.hour).padStart(2, '0')}`), series: [{ name: 'Focus', values: hours.hours.map((h) => h.min), color: 'var(--chart-3)' }], yFormat: minFmt, yUnit: 'minutes', tip: (i) => `${String(i).padStart(2, '0')}:00–${String(i + 1).padStart(2, '0')}:00\n${fmtDuration(hours.hours[i].min)} focus`, table: { head: ['Hour', 'Focus'], rows: hours.hours.map((h) => [`${h.hour}:00`, fmtDuration(h.min)]) } }) : '<p class="muted">No timed sessions in this period.</p>'}
        ${hours.untimed ? `<p class="muted small">${plural(hours.untimed, 'imported session')} from PomoFocus 1.x ${hours.untimed === 1 ? 'has' : 'have'} no start time and ${hours.untimed === 1 ? 'is' : 'are'} not shown here.</p>` : ''}
      </section>
      <section class="card">${sectionHead('Day of week (average)', { level: 2 })}
        ${chart({ type: 'bar', height: 190, label: 'Average focus per weekday', labels: wdNames, series: [{ name: 'Average focus', values: wdOrder.map((d) => d.avgMin), color: 'var(--chart-2)' }], yFormat: minFmt, yUnit: 'minutes', tip: (i) => `${wdNames[i]}\n${fmtDuration(wdOrder[i].avgMin)} on average over ${wdOrder[i].count} days`, table: { head: ['Weekday', 'Average focus', 'Total'], rows: wdOrder.map((d, i) => [wdNames[i], fmtDuration(d.avgMin), fmtDuration(d.min)]) } })}
      </section>
    </div>
    ${!projectId ? `<section class="card">${sectionHead('Focus by project', { level: 2 })}
      ${chart({ type: 'hbar', height: Math.max(60, proj.length * 34), label: 'Focus by project', rows: proj.map((x) => ({ label: x.name, value: x.min, color: x.color, display: fmtDuration(x.min, { compact: true }), tip: `${x.name}\n${fmtDuration(x.min)}, ${x.pomos} Pomodoros` })), table: { head: ['Project', 'Focus', 'Pomodoros'], rows: proj.map((x) => [x.name, fmtDuration(x.min), String(x.pomos)]) } })}</section>` : ''}`;
}

function tasksTab(p, projectId) {
  const t = taskStats(p.start, p.end, { projectId });
  const ax = timeAxis(p, t.series.map((d) => ({ date: d.date, pomos: d.planned, focusMin: d.plannedDone, completed: d.completed })));
  return `<div class="stat-row">
      ${stat({ label: 'Tasks completed', value: fmtNumber(t.completed) })}
      ${stat({ label: 'Planned on a day', value: fmtNumber(t.planned), sub: `${t.plannedDone} done on that day` })}
      ${stat({ label: 'On-day completion', value: t.planned ? fmtPct(t.plannedDone / t.planned) : '—', sub: 'of tasks planned for a day' })}
      ${stat({ label: 'Created', value: fmtNumber(t.created) })}
      ${stat({ label: 'Moves', value: fmtNumber(t.moved), sub: 'tasks moved to another day' })}
    </div>
    <section class="card">${sectionHead('Planned and completed', { level: 2 })}
      ${chart({ type: 'bar', height: 230, label: 'Tasks planned and completed', labels: ax.labels, series: [{ name: 'Planned for the day', values: ax.rows.map((d) => d.pomos), color: 'var(--chart-muted)' }, { name: 'Completed', values: ax.rows.map((d) => d.completed), color: 'var(--chart-1)' }], yFormat: (v) => fmtNumber(v), tip: (i) => `${ax.keyLabel(ax.rows[i])}\n${ax.rows[i].pomos} planned, ${ax.rows[i].completed} completed`, table: { head: ['Period', 'Planned', 'Done on the day', 'Completed (any)'], rows: ax.rows.map((d) => [ax.keyLabel(d), String(d.pomos), String(d.focusMin), String(d.completed)]) } })}
      <p class="muted small">“Completed” counts every task finished in the period, including ones that were never planned for a day.</p>
    </section>
    <section class="card">${sectionHead('Completed by priority', { level: 2 })}
      ${chart({ type: 'hbar', height: 110, label: 'Completed tasks by priority', rows: [['High', t.byPriority.high, 'var(--danger)'], ['Medium', t.byPriority.med, 'var(--warn)'], ['Low', t.byPriority.low, 'var(--text-3)']].map(([l, v, c]) => ({ label: l, value: v, color: c, display: String(v) })) })}
    </section>`;
}

function objectivesTab(p) {
  const o = objectiveStats(p.start, p.end);
  if (!o.total) return emptyState({ icon: 'target', title: 'No objectives yet', text: 'Create objectives to see their progress here.', action: '<a class="btn btn--primary" href="#/objectives">Go to objectives</a>' });
  return `<div class="stat-row">${stat({ label: 'Completed in period', value: String(o.completedInRange.length) })}${stat({ label: 'Active', value: String(o.active.length) })}${stat({ label: 'All objectives', value: String(o.total) })}</div>
    <div class="two-col">
      <section class="card">${sectionHead('Active objectives — task progress', { level: 2 })}
        ${o.active.length ? chart({ type: 'hbar', height: Math.max(60, o.active.length * 34), label: 'Active objective progress', format: (v) => fmtPct(v), rows: o.active.map((x) => ({ label: x.objective.title, value: x.ratio, color: 'var(--chart-2)', display: `${x.done}/${x.total}`, tip: `${x.objective.title}\n${x.done} of ${x.total} tasks, ${x.actualPomos} Pomodoros` })), table: { head: ['Objective', 'Tasks', 'Pomodoros'], rows: o.active.map((x) => [x.objective.title, `${x.done}/${x.total}`, String(x.actualPomos)]) } }) : '<p class="muted">No active objectives.</p>'}
      </section>
      <section class="card">${sectionHead('Focus by objective in period', { level: 2 })}
        ${o.focusByObjective.length ? chart({ type: 'hbar', height: Math.max(60, o.focusByObjective.length * 34), label: 'Focus by objective', rows: o.focusByObjective.map((x) => ({ label: x.title, value: x.min, color: 'var(--chart-3)', display: fmtDuration(x.min, { compact: true }) })) }) : '<p class="muted">No focus on objective tasks in this period.</p>'}
        ${o.completedInRange.length ? `<h3 class="sub-title">Completed</h3><ul class="plain-list">${o.completedInRange.map((x) => `<li>${icon('check', { size: 13 })}<a href="#/objectives/${esc(x.id)}">${esc(x.title)}</a> <span class="muted">${esc(formatKey(x.completedDate))}</span></li>`).join('')}</ul>` : ''}
      </section>
    </div>`;
}

function habitsTab(p) {
  const h = habitConsistency(p.start, p.end);
  if (!h.habits.length) return emptyState({ icon: 'leaf', title: 'No habits yet', action: '<a class="btn btn--primary" href="#/habits">Add a habit</a>' });
  const days = h.days;
  return `<section class="card">${sectionHead('Consistency by habit', { level: 2 })}
      ${chart({ type: 'hbar', height: Math.max(60, h.habits.length * 34), label: 'Habit completion rate', format: (v) => fmtPct(v), rows: h.habits.map((x) => ({ label: x.habit.name, value: x.ratio, color: 'var(--habit)', display: x.scheduled ? fmtPct(x.ratio) : '—', tip: `${x.habit.name}\n${x.done} of ${x.scheduled} scheduled days` })), table: { head: ['Habit', 'Done', 'Scheduled', 'Rate'], rows: h.habits.map((x) => [x.habit.name, String(x.done), String(x.scheduled), x.scheduled ? fmtPct(x.ratio) : '—']) } })}
    </section>
    ${days.length <= 92 ? `<section class="card">${sectionHead('Daily check-ins', { level: 2 })}
      ${chart({ type: 'bar', height: 190, label: 'Habits done per day', labels: days.map((d) => formatKey(d.date, { month: 'short', day: 'numeric' })), series: [{ name: 'Done', values: days.map((d) => d.done), color: 'var(--habit)' }, { name: 'Not done', values: days.map((d) => d.scheduled - d.done), color: 'var(--chart-muted)' }], stacked: true, yFormat: (v) => fmtNumber(v), tip: (i) => `${formatKey(days[i].date)}\n${days[i].done} of ${days[i].scheduled} habits` })}</section>` : ''}`;
}

function projectsTab(p) {
  const proj = focusByProject(p.start, p.end);
  const all_ = all('projects');
  if (!all_.length && !proj.length) return emptyState({ icon: 'folder', title: 'No projects yet', action: '<a class="btn btn--primary" href="#/projects">Create a project</a>' });
  const pva = plannedVsActual({ start: p.start, end: p.end });
  const t = taskStats(p.start, p.end);
  return `<section class="card">${sectionHead('Focus by project', { level: 2 })}
      ${chart({ type: 'hbar', height: Math.max(60, proj.length * 34), label: 'Focus by project', rows: proj.map((x) => ({ label: x.name, value: x.min, color: x.color, display: fmtDuration(x.min, { compact: true }) })) })}
    </section>
    <section class="card"><div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Project</th><th scope="col">Focus</th><th scope="col">Pomodoros</th><th scope="col">Share</th><th scope="col">Estimate accuracy</th></tr></thead><tbody>
      ${proj.map((x) => { const g = pva.byProject.find((b) => b.key === (x.projectId || '_none')); const tot = proj.reduce((s, y) => s + y.min, 0); return `<tr><th scope="row">${x.projectId ? `<a href="#/projects/${esc(x.projectId)}">${esc(x.name)}</a>` : esc(x.name)}</th><td>${fmtDuration(x.min)}</td><td>${x.pomos}</td><td>${fmtPct(tot ? x.min / tot : 0)}</td><td>${g && g.count ? `${fmtPct(g.ratio)} of plan (${g.count} tasks)` : '<span class="muted">—</span>'}</td></tr>`; }).join('')}
    </tbody></table></div><p class="muted small">${t.completed} tasks completed in this period. Estimate accuracy = actual Pomodoros ÷ planned, for finished tasks.</p></section>`;
}

function planningTab(p, q, projectId) {
  const basis = q.basis === 'latest' ? 'latest' : 'original';
  const includeUnreliable = q.legacy === '1';
  const scope = q.scope === 'all' ? 'all' : 'completed';
  const r = plannedVsActual({ start: p.kind === 'all' ? null : p.start, end: p.kind === 'all' ? null : p.end, basis, includeUnreliable, scope, projectId });
  const daily = dailyPlanVsActual(p.start, p.end > todayKey() ? todayKey() : p.end).filter((d) => d.plannedMin > 0 || d.actualMin > 0);
  const weeks = r.byWeek;
  return `<div class="planning-controls card card--flat">
      <label>Planned value ${segmented([{ value: 'original', label: 'Original estimate' }, { value: 'latest', label: 'Latest estimate' }], basis, { action: 'an-query', name: 'basis', label: 'Planned value' })}</label>
      <label>Tasks ${segmented([{ value: 'completed', label: 'Completed' }, { value: 'all', label: 'Completed + started' }], scope, { action: 'an-query', name: 'scope', label: 'Which tasks' })}</label>
      <label class="check-row check-row--inline"><input type="checkbox" data-change="an-legacy" ${includeUnreliable ? 'checked' : ''}> Include unreliable imported estimates</label>
    </div>
    ${r.excludedUnreliable && !includeUnreliable ? `<p class="notice">${icon('info', { size: 14 })} ${plural(r.excludedUnreliable, 'task')} from PomoFocus 1.x ${r.excludedUnreliable === 1 ? 'is' : 'are'} left out: version 1 raised estimates automatically when work ran over, so their original plan is unknown.</p>` : ''}
    ${r.count ? `<div class="stat-row">
      ${stat({ label: 'Tasks compared', value: String(r.count) })}
      ${stat({ label: 'Planned', value: `${r.planned}`, sub: `Pomodoros (${fmtDuration(r.plannedMin)})` })}
      ${stat({ label: 'Actual', value: `${r.actual}`, sub: `Pomodoros (${fmtDuration(r.actualMin)})` })}
      ${stat({ label: 'Variance', value: fmtSigned(r.variance), sub: `actual is ${fmtPct(r.ratio)} of planned` })}
      ${stat({ label: 'Within ±1 Pomodoro', value: fmtPct(r.withinOne), sub: `${r.underestimated} took longer, ${r.overestimated} took less` })}
    </div>
    ${r.underestimated > 0 && r.underestimated >= r.overestimated && r.ratio > 1 ? `<p class="insight insight--info">${icon('lightbulb', { size: 16, cls: 'insight__icon' })}<span>Across these tasks you spent ${fmtPct(r.ratio - 1)} more Pomodoros than planned.</span></p>` : ''}
    <div class="two-col">
      <section class="card">${sectionHead('By week', { level: 2 })}
        ${chart({ type: 'bar', height: 220, label: 'Planned vs actual Pomodoros by week', labels: weeks.map((w) => formatKey(w.key, { month: 'short', day: 'numeric' })), series: [{ name: 'Planned', values: weeks.map((w) => w.planned), color: 'var(--chart-muted)' }, { name: 'Actual', values: weeks.map((w) => w.actual), color: 'var(--chart-1)' }], yFormat: (v) => fmtNumber(v), tip: (i) => `Week of ${formatKey(weeks[i].key)}\nPlanned ${weeks[i].planned}, actual ${weeks[i].actual} (${weeks[i].count} tasks)`, table: { head: ['Week', 'Planned', 'Actual', 'Tasks'], rows: weeks.map((w) => [w.key, String(w.planned), String(w.actual), String(w.count)]) } })}
      </section>
      <section class="card">${sectionHead('Actual ÷ planned, by project', { level: 2 })}
        ${chart({ type: 'hbar', height: Math.max(60, r.byProject.length * 34), label: 'Estimation ratio by project', format: (v) => fmtPct(v), rows: r.byProject.map((g) => ({ label: g.label, value: g.ratio, color: g.ratio > 1.15 ? 'var(--warn)' : g.ratio < 0.85 ? 'var(--chart-3)' : 'var(--ok)', display: fmtPct(g.ratio), tip: `${g.label}\nPlanned ${g.planned}, actual ${g.actual} over ${g.count} tasks` })), table: { head: ['Project', 'Planned', 'Actual', 'Ratio', 'Tasks'], rows: r.byProject.map((g) => [g.label, String(g.planned), String(g.actual), fmtPct(g.ratio), String(g.count)]) } })}
        <p class="muted small">100% means exactly as planned; above means it took longer.</p>
      </section>
    </div>
    ${r.byTag.length > 1 ? `<section class="card">${sectionHead('By tag', { level: 2 })}${chart({ type: 'hbar', height: Math.max(60, Math.min(12, r.byTag.length) * 34), label: 'Estimation ratio by tag', format: (v) => fmtPct(v), rows: r.byTag.slice(0, 12).map((g) => ({ label: g.label, value: g.ratio, color: 'var(--chart-4)', display: fmtPct(g.ratio), tip: `${g.label}\nPlanned ${g.planned}, actual ${g.actual} over ${g.count} tasks` })) })}</section>` : ''}
    ${underestimatedList(r)}
    <section class="card">${sectionHead('Tasks', { level: 2, count: r.rows.length })}
      <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Task</th><th scope="col">Date</th><th scope="col">Planned</th><th scope="col">Actual</th><th scope="col">Variance</th></tr></thead><tbody>
      ${r.rows.slice(0, 100).map((x) => `<tr><th scope="row"><button type="button" class="link-btn" data-action="task-open" data-id="${esc(x.task.id)}">${esc(x.task.title)}</button></th><td>${esc(formatKey(x.anchor, { month: 'short', day: 'numeric' }))}</td><td>${x.planned}</td><td>${x.actual}</td><td class="${x.variance > 0 ? 'is-over' : x.variance < 0 ? 'is-under' : ''}">${fmtSigned(x.variance)}</td></tr>`).join('')}
      </tbody></table></div>${r.rows.length > 100 ? `<p class="muted small">Showing 100 of ${r.rows.length}.</p>` : ''}</section>`
    : emptyState({ icon: 'chart', title: 'Nothing to compare yet', text: 'Give tasks a Pomodoro estimate and complete them; this page then compares plan and reality.' })}
    ${daily.length ? `<section class="card">${sectionHead('Planned vs actual focus per day', { level: 2 })}
      ${chart({ type: 'line', height: 210, label: 'Planned vs actual focus per day', labels: daily.map((d) => formatKey(d.date, { month: 'short', day: 'numeric' })), series: [{ name: 'Planned', values: daily.map((d) => d.plannedMin), color: 'var(--chart-muted)', dashed: true }, { name: 'Actual', values: daily.map((d) => d.actualMin), color: 'var(--chart-1)', area: true }], yFormat: minFmt, yUnit: 'minutes', tip: (i) => `${formatKey(daily[i].date)}\nPlanned ${fmtDuration(daily[i].plannedMin)} (${daily[i].source}), actual ${fmtDuration(daily[i].actualMin)}`, table: { head: ['Date', 'Planned', 'Actual', 'Source'], rows: daily.map((d) => [d.date, fmtDuration(d.plannedMin), fmtDuration(d.actualMin), d.source]) } })}
      <p class="muted small">Days with a saved plan use its snapshot; other days use the estimates of tasks planned for them. Days with neither are left out.</p></section>` : ''}`;
}

function underestimatedList(r) {
  const g = r.underestimatedGroups;
  if (!g?.length) return '';
  return `<section class="card">${sectionHead('Often take longer than planned', { level: 2 })}<ul class="plain-list">${g.slice(0, 6).map((x) => `<li>${icon('lightbulb', { size: 13 })}<strong>${esc(x.label)}</strong> <span class="muted">${x.actual} actual vs ${x.planned} planned over ${x.count} tasks (${fmtPct(x.ratio)})</span></li>`).join('')}</ul><p class="muted small">Groups with at least 3 finished tasks that took 15% or more longer than estimated.</p></section>`;
}

function streaksTab() {
  const streaks = listStreaks();
  return `<div class="section-head"><p class="muted">Streaks are rules you choose. Days outside a streak’s active days never break it, and today only counts once it is met.</p>
      <button type="button" class="btn btn--primary btn--small" data-action="streak-new">${icon('plus', { size: 14 })}New streak</button></div>
    ${streaks.length ? `<div class="streak-grid">${streaks.map((s) => {
    const r = evaluateStreak(s.id);
    const recent = r.periods.slice(-60);
    return `<section class="card streak-card${s.enabled ? '' : ' is-off'}">
        <div class="streak-card__head"><h2 class="section-title">${icon('flame', { size: 16 })}${esc(s.name)}</h2><button type="button" class="icon-btn" data-action="streak-menu" data-id="${esc(s.id)}" aria-label="Actions for ${esc(s.name)}">${icon('more')}</button></div>
        <p class="muted small">${esc(describeStreak(s))}${s.enabled ? '' : ' — paused'}</p>
        <div class="streak-card__nums"><div><span class="streak-num">${r.current}</span><span class="muted">current ${r.unit}${r.current === 1 ? '' : 's'}</span></div><div><span class="streak-num streak-num--muted">${r.longest}</span><span class="muted">longest</span></div>
          <div class="streak-today">${r.todayMet === true ? `${icon('check', { size: 14 })} ${r.unit === 'week' ? 'This week' : 'Today'} counts` : r.todayMet === null ? 'Not an active day' : `${r.unit === 'week' ? 'This week' : 'Today'}: not yet`}</div></div>
        <div class="streak-strip" role="img" aria-label="Last ${recent.length} ${r.unit}s">${recent.map((x) => `<span class="streak-cell ${x.met === true ? 'is-met' : x.met === null ? 'is-off' : x.pending ? 'is-pending' : ''}" data-tip="${esc(`${r.unit === 'week' ? 'Week of ' : ''}${formatKey(x.key)}\n${x.met === true ? 'Met' : x.met === null ? 'Not an active day' : x.pending ? 'In progress' : 'Not met'}${x.value != null && STREAK_METRICS[s.metric].needsThreshold ? ` (${x.value})` : ''}`)}"></span>`).join('')}</div>
        ${r.periods.length > 6 ? chart({ type: 'line', height: 110, label: `${s.name} length over time`, labels: r.periods.slice(-90).map((x) => formatKey(x.key, { month: 'short', day: 'numeric' })), series: [{ name: 'Streak length', values: r.periods.slice(-90).map((x) => x.run), color: 'var(--accent)', area: true }], yFormat: (v) => fmtNumber(v) }) : ''}
      </section>`;
  }).join('')}</div>` : emptyState({ icon: 'flame', title: 'No streaks', text: 'Create a streak for anything that matters to you: daily focus, completing the Day Win, a habit…', action: '<button type="button" class="btn btn--primary" data-action="streak-new">Create a streak</button>' })}`;
}

export function render(route) {
  const tab = TABS.some(([k]) => k === route.parts[0]) ? route.parts[0] : 'overview';
  const q = route.query;
  const p = period(q);
  const projectId = q.project || null;
  const showProject = ['focus', 'tasks', 'planning'].includes(tab);
  const showPeriod = tab !== 'streaks';
  let body = '';
  switch (tab) {
    case 'focus': body = focusTab(p, projectId); break;
    case 'tasks': body = tasksTab(p, projectId); break;
    case 'objectives': body = objectivesTab(p); break;
    case 'habits': body = habitsTab(p); break;
    case 'projects': body = projectsTab(p); break;
    case 'planning': body = planningTab(p, q, projectId); break;
    case 'streaks': body = streaksTab(); break;
    default: body = overview(p);
  }
  const qs_ = new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
  return `<div class="page page--analytics">
    <header class="page-head"><div><h1 class="page-title">Analytics</h1><p class="page-head__sub">Everything here is calculated from your sessions and tasks.</p></div></header>
    <nav class="tabs tabs--scroll" aria-label="Analytics sections">${TABS.map(([k, l]) => `<a class="tab${k === tab ? ' is-on' : ''}" href="#/analytics/${k}${qs_ ? `?${qs_}` : ''}" ${k === tab ? 'aria-current="page"' : ''}>${esc(l)}</a>`).join('')}</nav>
    ${showPeriod ? `<div class="period-bar">
      ${segmented([{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }, { value: 'year', label: 'Year' }, { value: 'all', label: 'All' }, { value: 'custom', label: 'Custom' }], p.kind, { action: 'an-period', label: 'Period' })}
      ${['week', 'month', 'year'].includes(p.kind) ? `<div class="period-bar__nav"><button type="button" class="icon-btn" data-action="an-shift" data-value="-1" aria-label="Previous ${p.kind}">${icon('chevLeft')}</button><span class="period-bar__label">${esc(p.label)}</span><button type="button" class="icon-btn" data-action="an-shift" data-value="1" aria-label="Next ${p.kind}" ${p.end >= todayKey() ? 'disabled' : ''}>${icon('chevRight')}</button></div>`
    : p.kind === 'custom' ? `<div class="period-bar__nav"><label>From <input type="date" class="input input--small" value="${p.start}" data-change="an-from"></label><label>to <input type="date" class="input input--small" value="${p.end}" data-change="an-to"></label></div>` : `<span class="period-bar__label">${esc(p.label)}</span>`}
      ${showProject ? `<label class="filter">Project <select class="input input--small" data-change="an-project"><option value="">All projects</option>${projectOptions(projectId, { includeNone: false, includeArchived: true })}</select></label>` : ''}
    </div>` : ''}
    <div class="analytics-body">${body}</div>
    <details class="card definitions"><summary>How these numbers are calculated</summary>
      <dl class="facts facts--wide">
        <div><dt>Pomodoro</dt><dd>A completed focus session. Sessions stopped early are kept in History but not counted.</dd></div>
        <div><dt>Focus time</dt><dd>The sum of completed focus sessions’ actual length (breaks and pauses excluded).</dd></div>
        <div><dt>Planned</dt><dd>A task’s original estimate (or its latest estimate, if you choose). Earlier estimates are never overwritten.</dd></div>
        <div><dt>Actual</dt><dd>Completed focus sessions linked to the task. Variance = actual − planned.</dd></div>
        <div><dt>Active day</dt><dd>A day with at least one Pomodoro.</dd></div>
        <div><dt>Day Win completed</dt><dd>The Day Win task was completed on or before its day.</dd></div>
        <div><dt>Imported data</dt><dd>Sessions from PomoFocus 1.x have dates but no times; their durations come from v1’s daily totals.</dd></div>
      </dl>
      <button type="button" class="btn btn--small btn--ghost" data-action="an-recalc">${icon('reset', { size: 14 })}Recalculate analytics</button>
    </details>
  </div>`;
}

export function openStreakForm(s = null) {
  const x = s || { metric: 'pomodoros', threshold: 1, frequency: 'daily', activeDays: [0, 1, 2, 3, 4, 5, 6], habitIds: [] };
  const habits = listHabits();
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const m = openModal({
    title: s ? 'Edit streak' : 'New streak', size: 'md',
    body: `<form id="streak-form" class="form" novalidate>
      <div class="field"><label class="field__label" for="sf-name">Name</label><input id="sf-name" name="name" class="input" required maxlength="80" value="${esc(x.name || '')}" placeholder="e.g. Morning focus" autofocus></div>
      <div class="form-grid">
        <div class="field"><label class="field__label" for="sf-metric">What counts</label><select id="sf-metric" name="metric" class="input">${options(Object.entries(STREAK_METRICS).map(([k, v]) => ({ value: k, label: v.label })), x.metric)}</select></div>
        <div class="field" data-threshold><label class="field__label" for="sf-th">At least</label><span class="input-suffix"><input id="sf-th" type="number" name="threshold" min="1" class="input input--narrow" value="${x.threshold ?? 1}"><span data-unit>${esc(STREAK_METRICS[x.metric].unit)}</span></span></div>
        <div class="field"><label class="field__label" for="sf-freq">Frequency</label><select id="sf-freq" name="frequency" class="input">${options([{ value: 'daily', label: 'Each day' }, { value: 'weekly', label: 'Each week (total)' }], x.frequency)}</select></div>
      </div>
      <fieldset class="field" data-habits ${STREAK_METRICS[x.metric].needsHabits ? '' : 'hidden'}><legend class="field__label">Habits</legend>
        ${habits.length ? habits.map((h) => `<label class="check-row"><input type="checkbox" name="habitIds" value="${esc(h.id)}" ${x.habitIds.includes(h.id) ? 'checked' : ''}> ${esc(h.name)}</label>`).join('') : '<p class="muted">Create a habit first.</p>'}</fieldset>
      <fieldset class="field"><legend class="field__label">Active days</legend><div class="repeat-days">${WD.map((n, i) => `<label class="day-pill"><input type="checkbox" name="activeDays" value="${i}" ${x.activeDays.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
        <p class="field__hint">Inactive days are skipped — they neither extend nor break the streak.</p></fieldset>
      <p class="form-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="streak-form" class="btn btn--primary">${s ? 'Save' : 'Create streak'}</button>`,
    onMount(el, close) {
      const form = qs('#streak-form', el);
      const sync = () => {
        const spec = STREAK_METRICS[form.metric.value];
        qs('[data-threshold]', form).hidden = !spec.needsThreshold;
        qs('[data-unit]', form).textContent = spec.unit;
        qs('[data-habits]', form).hidden = !spec.needsHabits;
      };
      form.metric.addEventListener('change', sync); sync();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const days = fd.getAll('activeDays').map(Number);
        const fields = { name: fd.get('name'), metric: fd.get('metric'), threshold: fd.get('threshold'), frequency: fd.get('frequency'), habitIds: fd.getAll('habitIds'), activeDays: days };
        try {
          if (!days.length) throw new Error('Choose at least one active day.');
          const rec = s ? await updateStreak(s.id, fields) : await createStreak(fields);
          close(rec); toast(s ? 'Streak saved.' : 'Streak created.', { tone: 'success' });
        } catch (err) { const b = qs('.form-error', el); b.textContent = err.message; b.hidden = false; }
      });
    },
  });
  return m.result;
}

registerActions({
  'an-period': (el) => setQuery({ p: el.dataset.value, a: null }),
  'an-shift': (el) => { const p = period(Object.fromEntries(new URLSearchParams(location.hash.split('?')[1] || ''))); setQuery({ a: shiftPeriod(p.kind, p.start, Number(el.dataset.value)) }); },
  'an-from': (el) => setQuery({ from: el.value }),
  'an-to': (el) => setQuery({ to: el.value }),
  'an-project': (el) => setQuery({ project: el.value || null }),
  'an-query': (el) => setQuery({ [el.dataset.name]: el.dataset.value }),
  'an-legacy': (el) => setQuery({ legacy: el.checked ? '1' : null }),
  'an-recalc': () => { clearDerivedCaches(); toast('Analytics recalculated from your records.', { tone: 'success' }); navigate(location.hash); },
  'streak-new': () => openStreakForm(),
  'streak-edit': (el) => openStreakForm(get('streaks', el.dataset.id)),
  'streak-toggle': async (el) => { await toggleStreak(el.dataset.id); },
  'streak-menu': async (el) => {
    const { openMenu } = await import('../ui/components.js');
    const s = get('streaks', el.dataset.id);
    openMenu(el, [
      { label: 'Edit', icon: 'edit', action: 'streak-edit', data: { id: s.id } },
      { label: s.enabled ? 'Pause' : 'Resume', icon: s.enabled ? 'pause' : 'play', action: 'streak-toggle', data: { id: s.id } },
      { label: 'Delete', icon: 'trash', action: 'streak-delete', data: { id: s.id }, danger: true },
    ]);
  },
  'streak-delete': async (el) => {
    const s = get('streaks', el.dataset.id);
    if (!await confirmDialog({ title: 'Delete streak?', message: `“${s.name}” will be removed. Your underlying data is not affected.`, confirmLabel: 'Delete', danger: true })) return;
    const inv = await deleteStreak(s.id); undoToast('Streak deleted.', inv);
  },
});

export { dayWinHistory, diffDays, C };
