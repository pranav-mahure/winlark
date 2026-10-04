/** Calendar — a month at a glance, with the full record of any day. */
import { state, get } from '../core/state.js';
import { esc } from '../utils/dom.js';
import { todayKey, addMonths, formatMonth, weekdayNames, formatLong, isValidKey, relativeLabel, addDays } from '../utils/dates.js';
import { fmtDuration, plural } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { taskRow, progressBar, sectionHead } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { navigate, setQuery } from '../ui/router.js';
import { monthData } from '../features/calendar.js';
import { dayReview } from '../features/review.js';
import { sessionLabel } from '../features/sessions.js';
import { fmtTime } from '../utils/format.js';

export const title = 'Calendar';

const WIN_LABEL = { completed: 'Day Win completed', 'completed-later': 'Day Win completed later', moved: 'Day Win moved', 'not-completed': 'Day Win not completed', open: 'Day Win set' };

function dayPanel(date) {
  const today = todayKey();
  const r = dayReview(date, today);
  const win = r.dayWin;
  const future = date > today;
  return `<section class="card day-panel" aria-labelledby="dp-h">
    <div class="day-panel__head"><div><p class="page-head__kicker">${esc(relativeLabel(date, today))}</p><h2 id="dp-h" class="section-title">${esc(formatLong(date))}</h2></div>
      <div class="day-panel__links"><a class="btn btn--small btn--secondary" href="#/plan/${date}">${icon('plan', { size: 14 })}Plan</a>${future ? '' : `<a class="btn btn--small btn--secondary" href="#/review/${date}">${icon('review', { size: 14 })}Review</a>`}<a class="btn btn--small btn--ghost" href="#/history?from=${date}&to=${date}">History</a></div></div>
    <dl class="mini-stats">
      <div><dt>Focus</dt><dd>${fmtDuration(r.focus.actualMin)}</dd></div>
      <div><dt>Pomodoros</dt><dd>${r.focus.pomos}</dd></div>
      <div><dt>Tasks</dt><dd>${r.tasks.completed}/${r.tasks.total}</dd></div>
      ${r.habits.total ? `<div><dt>Habits</dt><dd>${r.habits.done}/${r.habits.total}</dd></div>` : ''}
      ${r.focus.plannedMin ? `<div><dt>Planned</dt><dd>${fmtDuration(r.focus.plannedMin)}</dd></div>` : ''}
    </dl>
    ${win.task ? `<p class="day-panel__win win-state--${win.key}">${icon(win.key === 'completed' ? 'starFill' : 'star', { size: 16 })}<span><strong>${esc(win.task.title)}</strong> — ${esc(win.label)}</span></p>` : ''}
    ${r.tasks.planned.length || r.tasks.moved.length ? `<h3 class="sub-title">Tasks</h3><ul class="task-list task-list--compact">${[...r.tasks.planned.map((x) => x.task), ...r.tasks.moved].map((t) => taskRow(t, { date, allowWin: !future || true })).join('')}</ul>` : ''}
    ${r.completions.filter((c) => c.source === 'history').length ? `<h3 class="sub-title">Also completed</h3><ul class="plain-list">${r.completions.filter((c) => c.source === 'history').map((c) => `<li>${icon('check', { size: 13 })}${esc(c.title)}</li>`).join('')}</ul>` : ''}
    ${r.projects.length ? `<h3 class="sub-title">Focus by project</h3><ul class="plain-list">${r.projects.map((p) => `<li><span class="chip__dot" style="--chip:${esc(p.color || 'var(--text-3)')}"></span>${esc(p.name)} <span class="muted">${fmtDuration(p.min)}, ${plural(p.pomos, 'Pomodoro')}</span></li>`).join('')}</ul>` : ''}
    ${r.review && (r.review.wentWell || r.review.change || r.review.notes) ? `<h3 class="sub-title">Reflection</h3><div class="notes">${esc([r.review.wentWell, r.review.change, r.review.notes].filter(Boolean).join('\n\n')).replace(/\n/g, '<br>')}</div>` : ''}
    ${!r.focus.pomos && !r.tasks.total && !future ? '<p class="muted">Nothing recorded on this day.</p>' : ''}
  </section>`;
}

export function render(route) {
  const today = todayKey();
  const ym = /^\d{4}-\d{2}$/.test(route.parts[0] || '') ? route.parts[0] : today.slice(0, 7);
  const year = +ym.slice(0, 4); const month = +ym.slice(5, 7) - 1;
  const sel = isValidKey(route.query.d) ? route.query.d : (today.startsWith(ym) ? today : `${ym}-01`);
  const cells = monthData(year, month, today);
  const ws = state.settings.general.weekStart;
  const prev = addMonths(`${ym}-01`, -1).slice(0, 7);
  const next = addMonths(`${ym}-01`, 1).slice(0, 7);
  const inMonth = cells.filter((c) => c.inMonth && !c.isFuture);
  const totalMin = inMonth.reduce((s, c) => s + c.focusMin, 0);
  const wins = inMonth.filter((c) => c.dayWin === 'completed').length;
  return `<div class="page page--calendar">
    <header class="page-head"><div><h1 class="page-title">${esc(formatMonth(year, month))}</h1><p class="page-head__sub">${fmtDuration(totalMin)} focused, ${plural(inMonth.filter((c) => c.pomos).length, 'active day')}, ${plural(wins, 'Day Win')} completed</p></div>
      <nav class="date-nav" aria-label="Month"><a class="icon-btn" href="#/calendar/${prev}" aria-label="Previous month">${icon('chevLeft')}</a><a class="chip-btn" href="#/calendar/${today.slice(0, 7)}?d=${today}">Today</a><a class="icon-btn" href="#/calendar/${next}" aria-label="Next month">${icon('chevRight')}</a></nav></header>
    <div class="calendar-layout">
      <div class="card calendar-card">
        <div class="cal-grid" role="grid" aria-label="${esc(formatMonth(year, month))}">
          <div class="cal-row cal-row--head" role="row">${weekdayNames(ws).map((n) => `<span class="cal-head" role="columnheader">${esc(n)}</span>`).join('')}</div>
          ${Array.from({ length: 6 }, (_, w) => `<div class="cal-row" role="row">${cells.slice(w * 7, w * 7 + 7).map((c) => `
            <button type="button" role="gridcell" class="cal-cell heat-bg--${c.level}${c.inMonth ? '' : ' is-outside'}${c.isToday ? ' is-today' : ''}${c.date === sel ? ' is-selected' : ''}${c.isFuture ? ' is-future' : ''}" data-action="cal-select" data-value="${c.date}" aria-selected="${c.date === sel}" aria-label="${esc(formatLong(c.date))}: ${c.pomos} Pomodoros, ${c.tasksDone} of ${c.tasksPlanned} tasks${c.dayWin !== 'none' ? `, ${WIN_LABEL[c.dayWin] || ''}` : ''}">
              <span class="cal-cell__day">${+c.date.slice(8)}</span>
              ${c.dayWin !== 'none' ? `<span class="cal-cell__win win-state--${c.dayWin}">${icon(c.dayWin === 'completed' ? 'starFill' : 'star', { size: 12 })}</span>` : ''}
              <span class="cal-cell__info">${c.pomos ? `<span class="cal-cell__pomos">${c.pomos}<span class="sr-only"> Pomodoros</span></span>` : ''}${c.tasksPlanned ? `<span class="cal-cell__tasks">${c.isFuture ? c.tasksPlanned : `${c.tasksDone}/${c.tasksPlanned}`}</span>` : ''}</span>
              ${c.habitsTotal ? `<span class="cal-cell__habits" style="--r:${(c.habitsDone / c.habitsTotal).toFixed(2)}"></span>` : ''}
              ${c.hasReview ? `<span class="cal-cell__review" title="Reviewed">${icon('review', { size: 10 })}</span>` : ''}
            </button>`).join('')}</div>`).join('')}
        </div>
        <div class="cal-legend"><span><span class="heat heat-swatch heat--0"></span>Less</span><span class="heat heat-swatch heat--2"></span><span><span class="heat heat-swatch heat--4"></span>More focus</span><span>${icon('starFill', { size: 12, cls: 'win-color' })} Day Win completed</span><span>${icon('star', { size: 12 })} Day Win not completed</span><span><b>3/5</b> tasks done/planned</span></div>
      </div>
      ${dayPanel(sel)}
    </div>
  </div>`;
}

registerActions({
  'cal-select': (el) => {
    const d = el.dataset.value;
    const cur = location.hash.match(/calendar\/(\d{4}-\d{2})/)?.[1];
    if (cur && d.slice(0, 7) !== cur) navigate(`#/calendar/${d.slice(0, 7)}?d=${d}`);
    else setQuery({ d });
  },
});

export { get, progressBar, sectionHead, sessionLabel, fmtTime, addDays };
