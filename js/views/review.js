/** Daily review — what was planned, what happened, and your own reflection. No scores. */
import { get } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { todayKey, addDays, formatLong, relativeLabel, isValidKey, formatKey } from '../utils/dates.js';
import { fmtDuration, fmtSigned, plural, fmtTime } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { pips, projectChip, sectionHead, emptyState } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { toast } from '../ui/toast.js';
import { chart } from '../ui/charts.js';
import { dayReview, saveReview } from '../features/review.js';
import { taskActual, sessionLabel } from '../features/sessions.js';

export const title = 'Daily review';

export function render(route) {
  const today = todayKey();
  const date = isValidKey(route.parts[0]) ? route.parts[0] : today;
  const r = dayReview(date, today);
  const future = date > today;
  const diff = r.focus.actualMin - r.focus.plannedMin;
  const win = r.dayWin;
  const rows = r.tasks.planned;
  const rv = r.review || {};
  const sessionsTimed = r.sessions.filter((s) => s.type === 'focus' && s.startTime);
  return `<div class="page page--review">
    <header class="page-head"><div><p class="page-head__kicker">Daily review — ${esc(relativeLabel(date, today))}</p><h1 class="page-title">${esc(formatLong(date))}</h1></div>
      <nav class="date-nav" aria-label="Day"><a class="icon-btn" href="#/review/${addDays(date, -1)}" aria-label="Previous day">${icon('chevLeft')}</a><a class="chip-btn${date === today ? ' is-on' : ''}" href="#/review/${today}">Today</a>${date < today ? `<a class="icon-btn" href="#/review/${addDays(date, 1)}" aria-label="Next day">${icon('chevRight')}</a>` : ''}</nav></header>
    ${future ? `<p class="notice">This day hasn’t happened yet. <a href="#/plan/${date}">Plan it instead</a>.</p>` : ''}
    <section class="review-summary">
      <div class="review-fact"><span class="review-fact__label">Focus</span><span class="review-fact__value">${fmtDuration(r.focus.actualMin)}</span>
        <span class="review-fact__sub">${r.focus.plannedMin ? `planned ${fmtDuration(r.focus.plannedMin)} (${r.focus.plannedSource}) — ${diff === 0 ? 'exactly as planned' : `${fmtSigned(Math.round(diff))} min`}` : 'no planned focus recorded'}</span></div>
      <div class="review-fact"><span class="review-fact__label">Pomodoros</span><span class="review-fact__value">${r.focus.pomos}</span><span class="review-fact__sub">${plural(r.sessions.filter((s) => s.type === 'focus' && !s.completed).length, 'session')} stopped early</span></div>
      <div class="review-fact"><span class="review-fact__label">Tasks</span><span class="review-fact__value">${r.tasks.completed}<small>/${r.tasks.total}</small></span><span class="review-fact__sub">${r.tasks.moved.length ? `${r.tasks.moved.length} moved to another day` : 'completed of planned'}</span></div>
      ${r.objectives.total ? `<div class="review-fact"><span class="review-fact__label">Objectives</span><span class="review-fact__value">${r.objectives.done}<small>/${r.objectives.total}</small></span><span class="review-fact__sub">fully done for the day</span></div>` : ''}
      ${r.habits.total ? `<div class="review-fact"><span class="review-fact__label">Habits</span><span class="review-fact__value">${r.habits.done}<small>/${r.habits.total}</small></span><span class="review-fact__sub">checked in</span></div>` : ''}
    </section>
    <section class="card review-win win-state--${win.key}">
      ${icon(win.key === 'completed' ? 'starFill' : 'star', { size: 22 })}
      <div><h2 class="section-title">Day Win</h2>${win.task ? `<p><button type="button" class="link-btn link-btn--strong" data-action="task-open" data-id="${esc(win.task.id)}">${esc(win.task.title)}</button> — ${esc(win.label)}${win.estimate != null ? ` (${win.actual}/${win.estimate} Pomodoros)` : ''}</p>` : '<p class="muted">No Day Win was set for this day.</p>'}</div>
    </section>
    <div class="two-col">
      <section class="card">${sectionHead('Planned vs actual, by task', { level: 2 })}
        ${rows.length || r.tasks.moved.length ? `<div class="table-scroll"><table class="data-table review-table"><thead><tr><th scope="col">Task</th><th scope="col">Planned</th><th scope="col">That day</th><th scope="col">Total</th><th scope="col">Outcome</th></tr></thead><tbody>
          ${rows.map((x) => { const t = x.task; const est = x.snapshotEstimate !== undefined ? x.snapshotEstimate : t.estimate; const total = taskActual(t.id).pomos; return `<tr><th scope="row"><button type="button" class="link-btn" data-action="task-open" data-id="${esc(t.id)}">${esc(t.title)}</button> ${projectChip(t.projectId, { compact: true })}</th><td>${est ?? '—'}</td><td>${x.pomosThatDay}</td><td>${total}${est != null ? ` <span class="muted">(${fmtSigned(total - est)})</span>` : ''}</td><td><span class="outcome outcome--${x.doneOnTime ? 'done' : t.status === 'completed' ? 'later' : date < today ? 'open' : 'pending'}">${x.doneOnTime ? 'Completed' : t.status === 'completed' ? `Completed ${esc(formatKey(t.completedDate, { month: 'short', day: 'numeric' }))}` : date < today ? 'Not completed' : 'Open'}</span></td></tr>`; }).join('')}
          ${r.tasks.moved.map((t) => { const mv = [...t.moveHistory].reverse().find((m) => m.from === date); return `<tr class="is-moved"><th scope="row"><button type="button" class="link-btn" data-action="task-open" data-id="${esc(t.id)}">${esc(t.title)}</button></th><td>${t.estimate ?? '—'}</td><td>—</td><td>${taskActual(t.id).pomos}</td><td><span class="outcome outcome--moved">Moved to ${mv?.to ? esc(formatKey(mv.to, { month: 'short', day: 'numeric' })) : 'inbox'}</span></td></tr>`; }).join('')}
          </tbody></table></div>
          ${r.plan.snapshot ? `<p class="muted small">Planned numbers come from the plan saved at ${esc(fmtTime(r.plan.snapshot.savedAt))}.${r.tasks.addedAfterSave.length ? ` ${plural(r.tasks.addedAfterSave.length, 'task was', 'tasks were')} added after saving.` : ''}${r.tasks.removedAfterSave.length ? ` ${plural(r.tasks.removedAfterSave.length, 'task was', 'tasks were')} removed after saving.` : ''}</p>` : '<p class="muted small">No plan was saved for this day, so planned numbers use the tasks’ current estimates.</p>'}`
    : '<p class="muted">No tasks were planned for this day.</p>'}
        ${r.completions.filter((c) => c.source === 'history').length ? `<p class="muted small">Also completed (imported history): ${r.completions.filter((c) => c.source === 'history').map((c) => esc(c.title)).join(', ')}</p>` : ''}
        ${r.objectives.results.length ? `<h3 class="sub-title">Objectives</h3><ul class="plain-list">${r.objectives.results.map((o) => `<li>${icon(o.done ? 'check' : 'target', { size: 13 })}<a href="#/objectives/${esc(o.objective.id)}">${esc(o.objective.title)}</a> <span class="muted">${o.completedTasks}/${o.onDay.length} tasks that day</span></li>`).join('')}</ul>` : ''}
      </section>
      <section class="card">${sectionHead('Where the time went', { level: 2 })}
        ${r.projects.length ? chart({ type: 'donut', height: 170, label: 'Focus by project', slices: r.projects.map((p) => ({ label: p.name, value: Math.round(p.min), color: p.color || 'var(--text-3)', tip: `${p.name}\n${fmtDuration(p.min)}, ${p.pomos} Pomodoros` })), center: { value: fmtDuration(r.focus.actualMin, { compact: true }), label: 'focus' }, table: { head: ['Project', 'Focus', 'Pomodoros'], rows: r.projects.map((p) => [p.name, fmtDuration(p.min), String(p.pomos)]) } })
    + `<ul class="legend-list">${r.projects.map((p) => `<li><span class="legend-swatch" style="--c:${esc(p.color || 'var(--text-3)')}"></span>${esc(p.name)}<span class="muted">${fmtDuration(p.min)}</span></li>`).join('')}</ul>` : '<p class="muted">No focus recorded.</p>'}
        ${sessionsTimed.length ? `<h3 class="sub-title">Sessions</h3><ul class="session-list">${r.sessions.map((s) => `<li class="session-item${s.completed ? '' : ' is-stopped'}"><span class="session-item__date">${s.startTime ? esc(fmtTime(s.startTime)) : '—'}</span><span>${esc(sessionLabel(s))}</span><span class="muted">${s.taskId ? esc(get('tasks', s.taskId)?.title || '') : s.type === 'focus' ? 'Unassigned' : ''}</span><span class="session-item__dur">${fmtDuration((s.actualDuration || 0) / 60)}</span></li>`).join('')}</ul>` : ''}
      </section>
    </div>
    <section class="card reflection">${sectionHead('Reflection', { level: 2 })}
      <form id="review-form" class="form" data-submit="review-save" data-date="${date}">
        <div class="field"><label class="field__label" for="rv-well">What went well?</label><textarea id="rv-well" name="wentWell" class="input" rows="3">${esc(rv.wentWell || '')}</textarea></div>
        <div class="field"><label class="field__label" for="rv-change">What should change tomorrow?</label><textarea id="rv-change" name="change" class="input" rows="3">${esc(rv.change || '')}</textarea></div>
        <div class="field"><label class="field__label" for="rv-notes">Notes</label><textarea id="rv-notes" name="notes" class="input" rows="2">${esc(rv.notes || '')}</textarea></div>
        <div class="form-actions">${rv.updatedAt ? `<span class="muted small">Saved at ${esc(fmtTime(rv.updatedAt))}</span>` : ''}<button type="submit" class="btn btn--primary">Save reflection</button>${date >= addDays(today, -1) ? `<a class="btn btn--secondary" href="#/plan/${addDays(date, 1)}">${icon('plan', { size: 15 })}Plan ${esc(relativeLabel(addDays(date, 1), today).toLowerCase())}</a>` : ''}</div>
      </form>
    </section>
  </div>`;
}

registerActions({
  'review-save': async (form, _e, fd) => {
    await saveReview(form.dataset.date, { wentWell: fd.get('wentWell'), change: fd.get('change'), notes: fd.get('notes') });
    toast('Reflection saved.', { tone: 'success' });
  },
});

export { emptyState, pips, qs };
