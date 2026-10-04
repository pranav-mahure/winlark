/** Today — what matters now: Day Win, current focus, next task, progress. */
import { state, get } from '../core/state.js';
import { esc } from '../utils/dom.js';
import { todayKey, addDays, formatLong, greeting, relativeLabel, formatKey } from '../utils/dates.js';
import { fmtDuration, fmtTime, plural } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { taskRow, pips, projectChip, objectiveChip, progressBar, emptyState, sectionHead } from '../ui/components.js';
import { dialSvg, modeTabs, controls, currentTaskLine } from '../ui/timer-ui.js';
import { registerList } from '../ui/handlers.js';
import { tasksOn, overdueOpen, unscheduledOpen, isOpen, taskActual } from '../features/tasks.js';
import { getPlan, dayWinStatus, workload, planObjectiveIds } from '../features/daily-plan.js';
import { focusOn, habitsOn, dayTasks } from '../features/analytics.js';
import { focusTargetMinutes } from '../features/settings.js';
import { timerView } from '../features/timer.js';
import { activeObjectives, objectiveProgress, objectiveDayResult } from '../features/objectives.js';
import { habitStreak, isDone } from '../features/habits.js';
import { habitIdsFor } from '../features/daily-plan.js';
import { planInsights } from '../features/insights.js';
import { evaluateStreak, listStreaks } from '../features/streaks.js';

export const title = 'Today';

function dayWinCard(today, tasks) {
  const st = dayWinStatus(today);
  const open = tasks.filter(isOpen);
  if (st.key === 'none') {
    if (!open.length) {
      return `<section class="win-card win-card--empty" aria-labelledby="win-h">
        <div class="win-card__icon">${icon('star', { size: 26 })}</div>
        <div class="win-card__body"><h2 id="win-h" class="win-card__label">Day Win</h2>
        <p class="win-card__prompt">Add today’s tasks, then choose the one that would make today a win.</p></div></section>`;
    }
    return `<section class="win-card win-card--empty" aria-labelledby="win-h">
      <div class="win-card__icon">${icon('star', { size: 26 })}</div>
      <div class="win-card__body"><h2 id="win-h" class="win-card__label">Day Win</h2>
        <p class="win-card__prompt">What one task would make today a win, even if nothing else gets done?</p>
        <div class="win-card__choices">${open.slice(0, 4).map((t) => `<button type="button" class="chip-btn chip-btn--win" data-action="daywin-toggle" data-id="${esc(t.id)}" data-date="${today}">${icon('star', { size: 13 })}${esc(t.title)}</button>`).join('')}
        ${open.length > 4 ? `<button type="button" class="chip-btn" data-action="daywin-pick" data-date="${today}">More…</button>` : ''}</div>
      </div></section>`;
  }
  const t = st.task;
  const a = taskActual(t.id);
  const done = st.key === 'completed' || st.key === 'completed-later';
  const active = timerView().taskId === t.id;
  return `<section class="win-card${done ? ' is-done' : ''}${st.key === 'moved' ? ' is-moved' : ''}" aria-labelledby="win-h">
    <div class="win-card__icon">${icon('starFill', { size: 28 })}</div>
    <div class="win-card__body">
      <h2 id="win-h" class="win-card__label">${done ? 'Day Win completed' : 'Today’s Day Win'}</h2>
      <button type="button" class="win-card__title" data-action="task-open" data-id="${esc(t.id)}">${esc(t.title)}</button>
      <div class="win-card__meta">${projectChip(t.projectId)}${objectiveChip(t.objectiveId)}${pips(a.pomos, t.estimate)}
        ${done && t.completedAt ? `<span class="meta-item">Completed at ${esc(fmtTime(t.completedAt))}</span>` : ''}
        ${st.key === 'moved' ? `<span class="meta-item is-moved">${esc(st.label)}</span>` : ''}</div>
    </div>
    <div class="win-card__actions">
      ${!done && st.key !== 'moved' ? `${active ? '' : `<button type="button" class="btn btn--win" data-action="task-focus" data-id="${esc(t.id)}" data-start>${icon('play', { size: 15 })}Focus on it</button>`}
        <button type="button" class="btn btn--secondary" data-action="task-toggle" data-id="${esc(t.id)}">${icon('check', { size: 15 })}Complete</button>` : ''}
      ${done ? `<button type="button" class="btn btn--ghost btn--small" data-action="task-toggle" data-id="${esc(t.id)}">Reopen</button>` : ''}
      <button type="button" class="btn btn--ghost btn--small" data-action="daywin-pick" data-date="${today}">Change</button>
    </div>
  </section>`;
}

function progressStrip(today) {
  const s = state.settings;
  const f = focusOn(today);
  const goal = s.goals.dailyPomos;
  const plan = getPlan(today);
  const target = plan.focusTargetMin ?? focusTargetMinutes(s);
  const dt = dayTasks(today);
  const h = habitsOn(today);
  const objIds = planObjectiveIds(today);
  const objDone = objIds.filter((id) => objectiveDayResult(id, today)?.done).length;
  const item = (label, value, sub, ratio, tone = 'accent') => `<div class="progress-item"><div class="progress-item__top"><span class="progress-item__value">${value}</span><span class="progress-item__label">${label}</span></div>${progressBar(ratio, { label, tone, size: 'sm' })}<span class="progress-item__sub">${sub}</span></div>`;
  return `<section class="progress-strip" aria-label="Today’s progress">
    ${item('Pomodoros', `${f.pomos}${goal ? `<small>/${goal}</small>` : ''}`, goal ? (f.pomos >= goal ? 'Daily goal reached' : `${goal - f.pomos} to go`) : 'No daily goal set', goal ? f.pomos / goal : (f.pomos ? 1 : 0))}
    ${item('Focus', fmtDuration(f.min), `of ${fmtDuration(target)} target`, target ? f.min / target : 0)}
    ${item('Tasks', `${dt.completed}<small>/${dt.total}</small>`, dt.total ? `${dt.total - dt.completed} open` : 'Nothing planned yet', dt.total ? dt.completed / dt.total : 0)}
    ${objIds.length ? item('Objectives', `${objDone}<small>/${objIds.length}</small>`, 'advanced today', objIds.length ? objDone / objIds.length : 0, 'secondary') : ''}
    ${h.total ? item('Habits', `${h.done}<small>/${h.total}</small>`, h.done === h.total ? 'All done' : `${h.total - h.done} left`, h.done / h.total, 'habit') : ''}
  </section>`;
}

function timerCard(today, tasks) {
  const v = timerView();
  const plan = getPlan(today);
  const winOpen = plan.dayWinTaskId && get('tasks', plan.dayWinTaskId) && isOpen(get('tasks', plan.dayWinTaskId));
  const queue = tasks.filter((t) => isOpen(t) && t.id !== v.taskId);
  if (winOpen) queue.sort((a, b) => (b.id === plan.dayWinTaskId) - (a.id === plan.dayWinTaskId));
  return `<section class="card timer-card dial--${v.mode}" aria-label="Timer">
    ${modeTabs(v)}
    ${dialSvg(v)}
    ${currentTaskLine(v)}
    ${controls(v)}
    <div class="timer-card__extras">
      <button type="button" class="link-btn" data-action="focus-mode">${icon('expand', { size: 14 })}Focus mode <kbd>F</kbd></button>
      ${state.settings.ambient.sound !== 'none' ? `<button type="button" class="link-btn" data-action="ambient-toggle">${icon('headphones', { size: 14 })}${esc(state.settings.ambient.sound === 'none' ? 'Ambient' : 'Ambient sound')}</button>` : ''}
    </div>
    ${queue.length ? `<div class="next-up"><h3 class="next-up__title">Next up</h3><ol class="next-up__list">${queue.slice(0, 3).map((t) => `<li><span class="next-up__name">${t.id === plan.dayWinTaskId ? icon('starFill', { size: 12, cls: 'win-color' }) : ''}${esc(t.title)}</span><span class="next-up__pomos">${pips(taskActual(t.id).pomos, t.estimate)}</span><button type="button" class="icon-btn" data-action="task-focus" data-id="${esc(t.id)}" aria-label="Focus on ${esc(t.title)}">${icon('play', { size: 14 })}</button></li>`).join('')}</ol></div>` : ''}
  </section>`;
}

function habitsCard(today) {
  const ids = habitIdsFor(today);
  if (!ids.length) {
    return state.habits.size ? '' : `<section class="card habits-card">${sectionHead('Habits', { level: 2 })}<p class="muted small">Small routines you want to keep, like reading or a walk. <a href="#/habits">Add a habit</a></p></section>`;
  }
  return `<section class="card habits-card">${sectionHead('Habits', { level: 2, actions: '<a class="link-btn" href="#/habits">Manage</a>' })}
    <ul class="habit-checks">${ids.map((id) => {
    const h = get('habits', id); const done = isDone(id, today); const st = habitStreak(h, today);
    return `<li><button type="button" class="habit-check${done ? ' is-done' : ''}" data-action="habit-toggle" data-id="${esc(id)}" data-date="${today}" aria-pressed="${done}"><span class="habit-check__box">${icon('check', { size: 13 })}</span><span class="habit-check__name">${esc(h.name)}</span>${h.target ? `<span class="habit-check__target">${esc(h.target)}</span>` : ''}${st.current ? `<span class="habit-check__streak" title="Current streak">${icon('flame', { size: 12 })}${st.current}</span>` : ''}</button></li>`;
  }).join('')}</ul></section>`;
}

function objectivesCard(today) {
  const ids = planObjectiveIds(today);
  const list = ids.length ? ids.map((id) => get('objectives', id)) : activeObjectives().slice(0, 3);
  if (!list.length) return '';
  return `<section class="card objectives-card">${sectionHead(ids.length ? 'Objectives today' : 'Active objectives', { level: 2, actions: '<a class="link-btn" href="#/objectives">All</a>' })}
    <ul class="objective-mini">${list.map((o) => {
    const p = objectiveProgress(o.id);
    return `<li><a href="#/objectives/${esc(o.id)}" class="objective-mini__title">${esc(o.title)}</a>${progressBar(p.ratio, { label: `${o.title} progress`, size: 'sm', tone: 'secondary' })}<span class="objective-mini__meta">${p.done}/${p.total} tasks${p.actualPomos ? `, ${plural(p.actualPomos, 'Pomodoro')}` : ''}</span></li>`;
  }).join('')}</ul></section>`;
}

function streakBadges() {
  const items = listStreaks({ enabledOnly: true }).slice(0, 3).map((s) => ({ s, r: evaluateStreak(s.id) })).filter((x) => x.r);
  if (!items.length) return '';
  return `<div class="streak-badges">${items.map(({ s, r }) => `<a class="streak-badge${r.current ? ' is-on' : ''}" href="#/analytics/streaks" title="${esc(s.name)}: current ${r.current}, best ${r.longest}">${icon('flame', { size: 14 })}<strong>${r.current}</strong><span>${esc(s.name)}</span></a>`).join('')}</div>`;
}

export function render() {
  const today = todayKey();
  const tasks = tasksOn(today);
  const open = tasks.filter((t) => t.status !== 'completed');
  const done = tasks.filter((t) => t.status === 'completed');
  const overdue = overdueOpen(today);
  const inbox = unscheduledOpen();
  const w = workload(today);
  const insights = planInsights(today).filter((i) => i.tone === 'attention' || i.id === 'no-daywin').slice(0, 2);
  const listKey = registerList('today', open.map((t) => t.id));
  const hour = new Date().getHours();
  const reviewNudge = hour >= 18 ? `<a class="btn btn--ghost" href="#/review/${today}">${icon('review', { size: 15 })}Review today</a>` : `<a class="btn btn--ghost" href="#/review/${addDays(today, -1)}">${icon('review', { size: 15 })}Yesterday’s review</a>`;
  return `<div class="page page--today">
    <header class="page-head">
      <div><p class="page-head__kicker">${esc(greeting())}</p><h1 class="page-title">${esc(formatLong(today))}</h1></div>
      <div class="page-head__actions">${streakBadges()}${reviewNudge}<a class="btn btn--secondary" href="#/plan/${addDays(today, 1)}">${icon('plan', { size: 15 })}Plan tomorrow</a></div>
    </header>
    <div class="today-grid">
      <div class="today-win">${dayWinCard(today, tasks)}</div>
      <div class="today-timer">${timerCard(today, tasks)}</div>
      <div class="today-progress">${progressStrip(today)}</div>
      <div class="today-main">
        ${insights.length ? `<div class="insight-list">${insights.map(insightHtml).join('')}</div>` : ''}
        <section class="card tasks-card" aria-labelledby="today-tasks-h">
          ${sectionHead('Today’s tasks', { level: 2, id: 'today-tasks-h', count: tasks.length ? `${done.length}/${tasks.length}` : null, actions: `${w.plannedPomos ? `<span class="workload-pill workload-pill--${w.level}" title="Planned focus vs your daily target">${fmtDuration(w.plannedFocusMin)} planned</span>` : ''}<a class="link-btn" href="#/plan/${today}">Open plan</a>` })}
          ${quickAddForm(today)}
          ${open.length ? `<ul class="task-list" data-sortable="tasks">${open.map((t) => taskRow(t, { date: today, sortable: true, listKey })).join('')}</ul>`
    : tasks.length ? '<p class="all-done">Everything planned for today is done.</p>'
      : emptyState({ icon: 'list', title: 'No tasks planned for today', text: 'Add one above, or pull in tasks from your inbox below.' })}
          ${done.length ? `<details class="done-group"><summary>Completed <span class="count">${done.length}</span></summary><ul class="task-list">${done.map((t) => taskRow(t, { date: today })).join('')}</ul></details>` : ''}
        </section>
        ${overdue.length ? `<section class="card overdue-card" aria-labelledby="overdue-h">
          ${sectionHead('Unfinished from earlier days', { level: 2, id: 'overdue-h', count: overdue.length, actions: overdue.length > 1 ? '<button type="button" class="link-btn" data-action="overdue-move-today">Move all to today</button>' : '' })}
          <p class="muted small">These stay on their original days as not completed until you choose to move them.</p>
          <ul class="task-list">${overdue.slice(0, 8).map((t) => taskRow(t, { showDate: true, allowWin: false })).join('')}</ul>
          ${overdue.length > 8 ? `<a class="link-btn" href="#/tasks?when=overdue">See all ${overdue.length}</a>` : ''}</section>` : ''}
        ${inbox.length ? `<details class="card inbox-card" ${tasks.length ? '' : 'open'}><summary class="section-head"><span class="section-title">Inbox</span> <span class="count">${inbox.length}</span><span class="muted small">Unscheduled tasks — plan them for a day when you’re ready.</span></summary>
          <ul class="task-list">${inbox.slice(0, 12).map((t) => taskRow(t, { allowWin: false })).join('')}</ul>
          ${inbox.length > 12 ? `<a class="link-btn" href="#/tasks?when=unscheduled">See all ${inbox.length}</a>` : ''}</details>` : ''}
      </div>
      <div class="today-side">${habitsCard(today)}${objectivesCard(today)}</div>
    </div>
  </div>`;
}

export function quickAddForm(date, { placeholder = 'Add a task…', projectId = '', objectiveId = '' } = {}) {
  return `<form class="quick-add" data-submit="quick-add" ${date === null ? 'data-date=""' : `data-date="${esc(date)}"`} ${projectId ? `data-project-id="${esc(projectId)}"` : ''} ${objectiveId ? `data-objective-id="${esc(objectiveId)}"` : ''} autocomplete="off">
    <span class="quick-add__icon">${icon('plus', { size: 16 })}</span>
    <input id="quick-add-input" name="q" class="quick-add__input" placeholder="${esc(placeholder)}" aria-label="New task" aria-describedby="qa-help-${esc(date || 'inbox')}" maxlength="300" enterkeyhint="done">
    <button type="submit" class="btn btn--primary btn--small">Add</button>
    <details class="quick-add__help"><summary aria-label="Quick add syntax">${icon('info', { size: 15 })}</summary>
      <div class="quick-add__tips" id="qa-help-${esc(date || 'inbox')}"><p>Type shortcuts right in the title:</p>
      <ul><li><code>~3</code> estimate 3 Pomodoros</li><li><code>!h</code> <code>!m</code> <code>!l</code> priority</li><li><code>#tag</code> add a tag</li><li><code>+Project</code> assign a project</li><li><code>@tomorrow</code> <code>@fri</code> <code>@oct 3</code> <code>@none</code> plan for a day</li><li><code>*</code> make it the Day Win</li></ul>
      <p class="muted">Example: <code>Draft report ~2 !h +Work *</code></p></div></details>
  </form>`;
}

export function insightHtml(i) {
  return `<div class="insight insight--${i.tone}">${icon(i.tone === 'attention' ? 'lightbulb' : 'info', { size: 16, cls: 'insight__icon' })}<div class="insight__body"><p>${esc(i.text)}</p>${i.detail ? `<p class="insight__detail">${esc(i.detail)}</p>` : ''}${i.actions?.length ? `<div class="insight__actions">${i.actions.map((a) => `<button type="button" class="btn btn--small btn--secondary" data-action="${esc(a.action)}" ${a.id ? `data-id="${esc(a.id)}"` : ''} ${a.taskId ? `data-task-id="${esc(a.taskId)}"` : ''} ${a.to ? `data-to="${esc(a.to)}"` : ''} ${a.date ? `data-date="${esc(a.date)}"` : ''}>${esc(a.label)}</button>`).join('')}</div>` : ''}</div></div>`;
}

export { relativeLabel, formatKey };
