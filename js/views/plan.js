/** Plan — shape a day before it starts (tomorrow by default). */
import { state, get } from '../core/state.js';
import { esc } from '../utils/dom.js';
import { todayKey, addDays, formatLong, relativeLabel, isValidKey, formatKey } from '../utils/dates.js';
import { fmtDuration, fmtDateTime, fmtPct } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { taskRow, pips, emptyState, sectionHead, progressBar } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { registerList } from '../ui/handlers.js';
import { navigate } from '../ui/router.js';
import { toast } from '../ui/toast.js';
import { quickAddForm, insightHtml } from './today.js';
import { tasksOn, overdueOpen, unscheduledOpen, isOpen, taskActual, updateTask, ensureOccurrences } from '../features/tasks.js';
import { getPlan, workload, WORKLOAD_LABEL, planObjectiveIds, toggleObjectiveForDay, habitIdsFor, setHabitIncluded, updatePlan, savePlan, dayWinStatus } from '../features/daily-plan.js';
import { focusTargetMinutes } from '../features/settings.js';
import { activeObjectives, objectiveProgress } from '../features/objectives.js';
import { listHabits, isScheduled } from '../features/habits.js';
import { planInsights } from '../features/insights.js';

export const title = 'Plan';

function planDate(route) {
  const d = route.parts[0];
  return isValidKey(d) ? d : addDays(todayKey(), 1);
}

function workloadCard(date) {
  const w = workload(date);
  const s = state.settings;
  const plan = getPlan(date);
  const max = Math.max(w.targetMin * (s.goals.workloadHeavyPct / 100) * 1.25, w.plannedFocusMin, 1);
  const pos = (m) => `${Math.min(100, (m / max) * 100).toFixed(1)}%`;
  const lightAt = w.targetMin * (s.goals.workloadLightPct / 100);
  const heavyAt = w.targetMin * (s.goals.workloadHeavyPct / 100);
  return `<section class="card workload-card workload--${w.level}" aria-labelledby="wl-h">
    <div class="workload-card__head">
      <div><h2 id="wl-h" class="section-title">Workload</h2>
        <p class="workload-card__level"><span class="workload-pill workload-pill--${w.level}">${WORKLOAD_LABEL[w.level]}</span> ${fmtDuration(w.plannedFocusMin)} planned of ${fmtDuration(w.targetMin)} target${w.targetMin ? ` (${fmtPct(w.ratio)})` : ''}</p></div>
    </div>
    <div class="gauge" role="img" aria-label="${fmtDuration(w.plannedFocusMin)} planned against ${fmtDuration(w.targetMin)} target: ${WORKLOAD_LABEL[w.level]}">
      <div class="gauge__zones"><span class="gauge__zone gauge__zone--light" style="width:${pos(lightAt)}"></span><span class="gauge__zone gauge__zone--moderate" style="left:${pos(lightAt)};width:calc(${pos(heavyAt)} - ${pos(lightAt)})"></span><span class="gauge__zone gauge__zone--heavy" style="left:${pos(heavyAt)};right:0"></span></div>
      <span class="gauge__fill" style="width:${pos(w.plannedFocusMin)}"></span>
      <span class="gauge__target" style="left:${pos(w.targetMin)}" title="Target"></span>
    </div>
    <div class="gauge__legend"><span>Light below ${fmtDuration(lightAt)}</span><span>Heavy above ${fmtDuration(heavyAt)}</span></div>
    <dl class="mini-stats">
      <div><dt>Tasks</dt><dd>${w.tasks}</dd></div>
      <div><dt>Pomodoros</dt><dd>${w.plannedPomos}</dd></div>
      <div><dt>Remaining</dt><dd>${fmtDuration(w.remainingFocusMin)}</dd></div>
      ${w.unestimated ? `<div><dt>No estimate</dt><dd>${w.unestimated}</dd></div>` : ''}
      ${w.habitMin ? `<div><dt>Habits</dt><dd>${fmtDuration(w.habitMin)}</dd></div>` : ''}
    </dl>
    <div class="workload-card__target">
      <label for="plan-target">Focus target for this day</label>
      <span class="input-suffix"><input id="plan-target" type="number" min="0" max="1440" step="5" class="input input--narrow" value="${plan.focusTargetMin ?? ''}" placeholder="${focusTargetMinutes(s)}" data-change="plan-target" data-date="${date}"><span>min</span></span>
      ${plan.focusTargetMin != null ? `<button type="button" class="link-btn" data-action="plan-target-reset" data-date="${date}">Use default (${fmtDuration(focusTargetMinutes(s))})</button>` : `<span class="muted small">Default from settings</span>`}
    </div>
  </section>`;
}

function estimateStepper(t) {
  if (t.status === 'completed') return `<div class="task-row__pomos">${pips(taskActual(t.id).pomos, t.estimate)}</div>`;
  return `<div class="est-stepper" role="group" aria-label="Estimate for ${esc(t.title)}">
    <button type="button" class="icon-btn icon-btn--tiny" data-action="task-est" data-id="${esc(t.id)}" data-dir="-1" aria-label="Fewer Pomodoros" ${!t.estimate ? 'disabled' : ''}>−</button>
    <span class="est-stepper__value" title="Planned Pomodoros">${t.estimate ?? '–'}</span>
    <button type="button" class="icon-btn icon-btn--tiny" data-action="task-est" data-id="${esc(t.id)}" data-dir="1" aria-label="More Pomodoros">+</button></div>`;
}

function pullList(title, tasks, date, { note = '', limit = 10 } = {}) {
  if (!tasks.length) return '';
  return `<details class="pull-group" ${tasks.length <= 5 ? 'open' : ''}><summary>${esc(title)} <span class="count">${tasks.length}</span></summary>
    ${note ? `<p class="muted small">${note}</p>` : ''}
    <ul class="pull-list">${tasks.slice(0, limit).map((t) => `<li><span class="pull-list__title">${esc(t.title)}</span><span class="pull-list__meta">${t.plannedDate ? esc(relativeLabel(t.plannedDate)) : ''} ${pips(taskActual(t.id).pomos, t.estimate)}</span>
      <button type="button" class="btn btn--small btn--secondary" data-action="task-plan" data-id="${esc(t.id)}" data-to="${date}">${icon('plus', { size: 13 })}Add</button></li>`).join('')}</ul>
    ${tasks.length > limit ? `<p class="muted small">${tasks.length - limit} more in <a href="#/tasks">Tasks</a>.</p>` : ''}</details>`;
}

function snapshotStatus(date) {
  const plan = getPlan(date);
  if (!plan.saved || !plan.snapshot) return '<span class="muted small">Not saved yet. Saving keeps a snapshot so the review can compare plan and reality.</span>';
  const snap = plan.snapshot;
  const current = tasksOn(date);
  const ids = new Set(snap.tasks.map((x) => x.id));
  let changes = current.filter((t) => !ids.has(t.id)).length + snap.tasks.filter((x) => !current.some((t) => t.id === x.id)).length;
  for (const x of snap.tasks) { const t = current.find((c) => c.id === x.id); if (t && t.estimate !== x.estimate) changes++; }
  return `<span class="saved-state">${icon('check', { size: 14 })} Saved ${esc(fmtDateTime(plan.savedAt))}${changes ? ` — ${changes} change${changes === 1 ? '' : 's'} since` : ''}</span>`;
}

export function render(route) {
  const date = planDate(route);
  const today = todayKey();
  if (date >= today) ensureOccurrences(date); // generates repeating tasks for that day (async, re-renders when done)
  const tasks = tasksOn(date);
  const plan = getPlan(date);
  const listKey = registerList(`plan-${date}`, tasks.filter((t) => t.status !== 'completed').map((t) => t.id));
  const winSt = dayWinStatus(date);
  const insights = planInsights(date);
  const objIds = planObjectiveIds(date);
  const fromTasks = new Set(tasks.map((t) => t.objectiveId).filter(Boolean));
  const objectives = activeObjectives();
  const habits = listHabits({ includeInactive: false });
  const habitSel = new Set(habitIdsFor(date));
  const past = date < today;
  const overdue = overdueOpen(today).filter((t) => t.plannedDate !== date);
  const inbox = unscheduledOpen();
  const todaysOpen = date > today ? tasksOn(today).filter((t) => isOpen(t) && t.kind !== 'occurrence') : [];
  return `<div class="page page--plan">
    <header class="page-head">
      <div><p class="page-head__kicker">Plan for ${esc(relativeLabel(date, today))}</p><h1 class="page-title">${esc(formatLong(date))}</h1></div>
      <nav class="date-nav" aria-label="Choose a day">
        <a class="icon-btn" href="#/plan/${addDays(date, -1)}" aria-label="Previous day">${icon('chevLeft')}</a>
        <a class="chip-btn${date === today ? ' is-on' : ''}" href="#/plan/${today}">Today</a>
        <a class="chip-btn${date === addDays(today, 1) ? ' is-on' : ''}" href="#/plan/${addDays(today, 1)}">Tomorrow</a>
        <input type="date" class="input input--small" value="${date}" data-change="plan-date" aria-label="Pick a date">
        <a class="icon-btn" href="#/plan/${addDays(date, 1)}" aria-label="Next day">${icon('chevRight')}</a>
      </nav>
    </header>
    ${past ? `<p class="notice">${icon('info', { size: 14 })} This day is in the past. Changes here edit its record; the <a href="#/review/${date}">review</a> shows what happened.</p>` : ''}
    <div class="plan-grid">
      <div class="plan-main">
        <section class="card plan-win" aria-labelledby="pw-h">
          ${sectionHead('Day Win', { level: 2, id: 'pw-h' })}
          ${winSt.task ? `<div class="plan-win__current">${icon('starFill', { size: 20, cls: 'win-color' })}<button type="button" class="plan-win__title" data-action="task-open" data-id="${esc(winSt.task.id)}">${esc(winSt.task.title)}</button><span class="meta-item">${esc(winSt.label)}</span>
            <button type="button" class="link-btn" data-action="daywin-pick" data-date="${date}">Change</button><button type="button" class="link-btn" data-action="daywin-clear" data-date="${date}">Clear</button></div>`
    : `<p class="muted">${tasks.some(isOpen) ? 'Choose the one task that would make this day a win.' : 'Add tasks below, then choose one as the Day Win.'}</p>${tasks.some(isOpen) ? `<button type="button" class="btn btn--win btn--small" data-action="daywin-pick" data-date="${date}">${icon('star', { size: 14 })}Choose Day Win</button>` : ''}`}
        </section>
        <section class="card" aria-labelledby="pt-h">
          ${sectionHead('Tasks', { level: 2, id: 'pt-h', count: tasks.length || null, actions: `<button type="button" class="link-btn" data-action="new-task" data-date="${date}">Detailed task…</button>` })}
          ${quickAddForm(date, { placeholder: `Add a task for ${relativeLabel(date, today).toLowerCase()}…` })}
          ${tasks.length ? `<ul class="task-list" data-sortable="tasks">${tasks.map((t) => taskRow(t, { date, sortable: t.status !== 'completed', listKey, extra: estimateStepper })).join('')}</ul>
            <p class="muted small">Drag the handle, use Alt+↑/↓, or the ⋯ menu to change the order. The order is the order you’ll work in.</p>`
    : emptyState({ icon: 'plan', title: 'Nothing planned for this day yet', text: 'Add tasks above or pull them in from the lists on the right.' })}
        </section>
        <section class="card" aria-labelledby="po-h">
          ${sectionHead('Objectives for the day', { level: 2, id: 'po-h' })}
          ${objectives.length ? `<div class="toggle-chips" role="group" aria-labelledby="po-h">${objectives.map((o) => {
    const on = objIds.includes(o.id); const auto = fromTasks.has(o.id);
    const p = objectiveProgress(o.id);
    return `<button type="button" class="toggle-chip${on ? ' is-on' : ''}" data-action="plan-objective-toggle" data-id="${esc(o.id)}" data-date="${date}" aria-pressed="${on}" ${auto ? 'disabled title="Included because tasks for this day belong to it"' : ''}>${icon(on ? 'check' : 'target', { size: 13 })}${esc(o.title)}<span class="toggle-chip__meta">${p.done}/${p.total}</span></button>`;
  }).join('')}</div><p class="muted small">Objectives with tasks on this day are included automatically.</p>`
    : `<p class="muted">No active objectives. <a href="#/objectives">Create one</a> to group tasks toward a bigger outcome.</p>`}
        </section>
        <section class="card" aria-labelledby="ph-h">
          ${sectionHead('Habits for the day', { level: 2, id: 'ph-h' })}
          ${habits.length ? `<div class="toggle-chips">${habits.map((h) => `<button type="button" class="toggle-chip${habitSel.has(h.id) ? ' is-on' : ''}" data-action="plan-habit-toggle" data-id="${esc(h.id)}" data-date="${date}" aria-pressed="${habitSel.has(h.id)}">${icon(habitSel.has(h.id) ? 'check' : 'leaf', { size: 13 })}${esc(h.name)}${!isScheduled(h, date) ? '<span class="toggle-chip__meta">not scheduled</span>' : ''}</button>`).join('')}</div>`
    : '<p class="muted">No habits yet. <a href="#/habits">Add a habit</a>.</p>'}
        </section>
        <section class="card" aria-labelledby="pi-h">
          ${sectionHead('Intention', { level: 2, id: 'pi-h' })}
          <label class="sr-only" for="plan-intention">Intention for the day</label>
          <textarea id="plan-intention" class="input" rows="2" placeholder="What would a good day look like? (optional)" data-change="plan-intention" data-date="${date}">${esc(plan.intention || '')}</textarea>
        </section>
        <div class="plan-save">
          ${snapshotStatus(date)}
          <button type="button" class="btn btn--primary" data-action="plan-save" data-date="${date}">${icon('check', { size: 16 })}${plan.saved ? 'Update saved plan' : 'Save plan'}</button>
        </div>
      </div>
      <aside class="plan-side">
        ${workloadCard(date)}
        ${insights.length ? `<section class="card assistant-card" aria-labelledby="as-h"><h2 id="as-h" class="section-title">${icon('lightbulb', { size: 16 })} Planning assistant</h2>
          <p class="muted small">Observations from your own history. Nothing changes unless you choose an action.</p>
          <div class="insight-list">${insights.map(insightHtml).join('')}</div></section>` : ''}
        <section class="card pull-card" aria-labelledby="pull-h"><h2 id="pull-h" class="section-title">Add existing tasks</h2>
          ${pullList(`Still open today`, todaysOpen, date, { note: 'Moving them keeps a record on today.' })}
          ${pullList('Unfinished from earlier days', overdue, date)}
          ${pullList('Inbox', inbox, date)}
          ${!todaysOpen.length && !overdue.length && !inbox.length ? '<p class="muted small">No open tasks waiting elsewhere.</p>' : ''}
        </section>
      </aside>
    </div>
  </div>`;
}

registerActions({
  'plan-date': (el) => { if (isValidKey(el.value)) navigate(`#/plan/${el.value}`); },
  'plan-target': async (el) => {
    const v = el.value === '' ? null : Math.max(0, Math.min(1440, Math.round(Number(el.value))));
    if (el.value !== '' && !Number.isFinite(Number(el.value))) throw new Error('Enter minutes as a number.');
    await updatePlan(el.dataset.date, { focusTargetMin: v });
  },
  'plan-target-reset': (el) => updatePlan(el.dataset.date, { focusTargetMin: null }),
  'plan-objective-toggle': (el) => toggleObjectiveForDay(el.dataset.date, el.dataset.id),
  'plan-habit-toggle': (el) => setHabitIncluded(el.dataset.date, el.dataset.id, el.getAttribute('aria-pressed') !== 'true'),
  'plan-intention': (el) => updatePlan(el.dataset.date, { intention: el.value }),
  'plan-save': async (el) => {
    await savePlan(el.dataset.date);
    toast(`Plan for ${relativeLabel(el.dataset.date)} saved. The review will compare against it.`, { tone: 'success' });
  },
  'task-est': async (el) => {
    const t = get('tasks', el.dataset.id);
    if (!t) return;
    const v = Math.max(0, Math.min(999, (t.estimate ?? 0) + Number(el.dataset.dir)));
    await updateTask(t.id, { estimate: v });
  },
});

export { formatKey };
