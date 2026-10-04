/** Task dialogs: create/edit form, detail view, move-to-date and task picker. */
import { state, get } from '../core/state.js';
import { esc, qs, qsa } from '../utils/dom.js';
import { todayKey, addDays, formatKey, formatLong, relativeLabel, weekday, startOfWeek, isValidKey } from '../utils/dates.js';
import { fmtDuration, fmtDateTime, fmtSigned, PRIORITY_LABEL } from '../utils/format.js';
import { icon } from './icons.js';
import { openModal, confirmDialog } from './modals.js';
import { toast, errorToast } from './toast.js';
import { projectOptions, objectiveOptions, pips, projectChip, objectiveChip, emptyState } from './components.js';
import {
  createTask, updateTask, moveTask, makeRecurring, describeRecurrence, taskActual, openTasks, isOpen,
  blockingTasks, dependents, searchTasks,
} from '../features/tasks.js';
import { setDayWin, clearDayWin, getPlan, dayWinDatesFor } from '../features/daily-plan.js';
import { sessionLabel } from '../features/sessions.js';
import { ValidationError } from '../utils/validation.js';

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function recurrenceFields(rec, disabled = false) {
  const freq = rec?.freq || 'none';
  const days = rec?.days || [];
  return `<div class="field"><label class="field__label" for="tf-repeat">Repeat</label>
    <select id="tf-repeat" name="repeat" ${disabled ? 'disabled' : ''} data-esc-local>
      ${[['none', 'Does not repeat'], ['daily', 'Every day'], ['weekdays', 'Weekdays (Mon–Fri)'], ['weekly', 'Weekly on…'], ['interval', 'Every N days']]
    .map(([v, l]) => `<option value="${v}" ${v === freq ? 'selected' : ''}>${l}</option>`).join('')}
    </select>
    <div class="repeat-days" data-show-when="weekly" ${freq === 'weekly' ? '' : 'hidden'}>
      ${WD.map((n, i) => `<label class="day-pill"><input type="checkbox" name="repeatDay" value="${i}" ${days.includes(i) ? 'checked' : ''}><span>${n}</span></label>`).join('')}
    </div>
    <div class="repeat-interval" data-show-when="interval" ${freq === 'interval' ? '' : 'hidden'}>
      <label>Every <input type="number" name="repeatInterval" min="1" max="365" value="${rec?.interval || 2}" class="input input--narrow"> days</label>
    </div>
    <p class="field__hint">Each day gets its own copy, so finishing or skipping one day never changes another.</p>
  </div>`;
}

function readRecurrence(fd, plannedDate) {
  const freq = fd.get('repeat');
  if (!freq || freq === 'none') return null;
  const days = fd.getAll('repeatDay').map(Number);
  return { freq, days: freq === 'weekly' ? (days.length ? days : [weekday(plannedDate || todayKey())]) : [], interval: Number(fd.get('repeatInterval')) || 2 };
}

function dependencyOptions(task) {
  const selected = new Set(task?.dependsOn || []);
  const list = openTasks().filter((t) => t.id !== task?.id).slice(0, 200);
  for (const id of selected) { const t = get('tasks', id); if (t && !list.includes(t)) list.unshift(t); }
  if (!list.length) return '<p class="field__hint">No other open tasks to depend on.</p>';
  return `<input type="search" class="input input--small" placeholder="Filter tasks…" data-dep-filter aria-label="Filter dependency list">
    <div class="dep-list" role="group" aria-label="Depends on">${list.map((t) => `<label class="dep-item"><input type="checkbox" name="dependsOn" value="${esc(t.id)}" ${selected.has(t.id) ? 'checked' : ''}><span>${esc(t.title)}</span>${t.plannedDate ? `<small>${esc(formatKey(t.plannedDate, { month: 'short', day: 'numeric' }))}</small>` : ''}</label>`).join('')}</div>`;
}

/**
 * Create or edit a task.
 * opts: { task, defaults: { plannedDate, projectId, objectiveId, dayWin } }
 */
export function openTaskForm({ task = null, defaults = {} } = {}) {
  const t = task || {};
  const isSeries = t.kind === 'series';
  const isOcc = t.kind === 'occurrence';
  const plannedDate = task ? t.plannedDate : (defaults.plannedDate === undefined ? todayKey() : defaults.plannedDate);
  const isWin = task && plannedDate ? getPlan(plannedDate).dayWinTaskId === task.id : !!defaults.dayWin;
  const title = task ? (isSeries ? 'Edit repeating task' : 'Edit task') : 'New task';
  const body = `<form class="form task-form" id="task-form" novalidate>
    ${isOcc ? `<p class="notice">${icon('repeat', { size: 14 })} This is one day of a repeating task. Changes here apply to this day only. <button type="button" class="link-btn" data-edit-series="${esc(t.seriesId)}">Edit the whole series</button></p>` : ''}
    <div class="field"><label class="field__label" for="tf-title">Title</label>
      <input id="tf-title" name="title" class="input input--large" required maxlength="300" value="${esc(t.title || defaults.title || '')}" autofocus autocomplete="off"></div>
    <div class="form-grid">
      ${isSeries ? '' : `<div class="field"><label class="field__label" for="tf-date">Planned for</label>
        <input id="tf-date" type="date" name="plannedDate" class="input" value="${esc(plannedDate || '')}">
        <div class="quick-dates"><button type="button" class="chip-btn" data-set-date="${todayKey()}">Today</button><button type="button" class="chip-btn" data-set-date="${addDays(todayKey(), 1)}">Tomorrow</button><button type="button" class="chip-btn" data-set-date="">Unscheduled</button></div></div>`}
      <div class="field"><label class="field__label" for="tf-est">Pomodoro estimate</label>
        <div class="stepper"><button type="button" class="icon-btn" data-step="-1" aria-label="Decrease estimate">−</button>
        <input id="tf-est" type="number" name="estimate" min="0" max="999" class="input input--narrow" value="${t.estimate ?? defaults.estimate ?? ''}" placeholder="—" inputmode="numeric">
        <button type="button" class="icon-btn" data-step="1" aria-label="Increase estimate">+</button></div>
        ${task && t.originalEstimate != null && t.originalEstimate !== t.estimate ? `<p class="field__hint">Originally planned: ${t.originalEstimate}. History keeps both.</p>` : ''}
        ${t.estimateReliable === false ? `<p class="field__hint">${esc(t.estimateNote || 'Imported estimate may not reflect the original plan.')}</p>` : ''}</div>
      <div class="field"><span class="field__label" id="tf-prio-l">Priority</span>
        <div class="segmented" role="radiogroup" aria-labelledby="tf-prio-l">${['high', 'med', 'low'].map((p) => `<label class="segmented__btn segmented__radio"><input type="radio" name="priority" value="${p}" ${(t.priority || defaults.priority || 'med') === p ? 'checked' : ''}><span>${PRIORITY_LABEL[p]}</span></label>`).join('')}</div></div>
      <div class="field"><label class="field__label" for="tf-proj">Project</label>
        <select id="tf-proj" name="projectId" class="input">${projectOptions(t.projectId ?? defaults.projectId ?? null)}</select></div>
      <div class="field"><label class="field__label" for="tf-obj">Objective</label>
        <select id="tf-obj" name="objectiveId" class="input">${objectiveOptions(t.objectiveId ?? defaults.objectiveId ?? null)}</select></div>
      <div class="field"><label class="field__label" for="tf-due">Due date <span class="optional">optional</span></label>
        <input id="tf-due" type="date" name="dueDate" class="input" value="${esc(t.dueDate || '')}"></div>
    </div>
    ${isSeries || (!isOcc && (!task || t.kind === 'single')) ? recurrenceFields(t.recurrence) : ''}
    ${isSeries ? '' : `<label class="check-row"><input type="checkbox" name="dayWin" ${isWin ? 'checked' : ''}> <span>${icon('starFill', { size: 14, cls: 'win-color' })} Make this the Day Win for its planned day</span></label>`}
    <div class="field"><label class="field__label" for="tf-tags">Tags <span class="optional">comma separated</span></label>
      <input id="tf-tags" name="tags" class="input" value="${esc((t.tags || []).join(', '))}" placeholder="writing, deep-work" autocomplete="off"></div>
    <div class="field"><label class="field__label" for="tf-notes">Notes</label>
      <textarea id="tf-notes" name="notes" class="input" rows="3">${esc(t.notes || '')}</textarea></div>
    ${isSeries ? '' : `<details class="field" ${t.dependsOn?.length ? 'open' : ''}><summary class="field__label">Depends on <span class="optional">optional</span></summary>${dependencyOptions(task)}
      <p class="field__hint">Dependencies are reminders only — they never block you from starting a task.</p></details>`}
    <p class="form-error" role="alert" hidden></p>
  </form>`;
  const m = openModal({
    title, body, size: 'md',
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="task-form" class="btn btn--primary">${task ? 'Save changes' : 'Add task'}</button>`,
    onMount(el) {
      const form = qs('#task-form', el);
      form.addEventListener('click', (e) => {
        const d = e.target.closest('[data-set-date]');
        if (d) { form.plannedDate.value = d.dataset.setDate; }
        const st = e.target.closest('[data-step]');
        if (st) { const v = Math.max(0, Math.min(999, (Number(form.estimate.value) || 0) + Number(st.dataset.step))); form.estimate.value = v; }
        const es = e.target.closest('[data-edit-series]');
        if (es) { m.close(); const s = get('tasks', es.dataset.editSeries); if (s) openTaskForm({ task: s }); }
      });
      form.repeat?.addEventListener('change', () => {
        for (const box of qsa('[data-show-when]', form)) box.hidden = box.dataset.showWhen !== form.repeat.value;
      });
      qs('[data-dep-filter]', form)?.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        for (const item of qsa('.dep-item', form)) item.hidden = !item.textContent.toLowerCase().includes(q);
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const err = qs('.form-error', form);
        err.hidden = true;
        try {
          const saved = await saveTaskForm(task, new FormData(form));
          m.close(saved);
        } catch (ex) {
          err.textContent = ex.message || 'Could not save the task.';
          err.hidden = false;
          if (ex.field === 'Task title' || /title/i.test(ex.message)) form.title.focus();
          if (!(ex instanceof ValidationError)) console.error(ex);
        }
      });
    },
  });
  return m.result;
}

async function saveTaskForm(task, fd) {
  const plannedDate = fd.has('plannedDate') ? (fd.get('plannedDate') || null) : (task?.plannedDate ?? null);
  if (plannedDate && !isValidKey(plannedDate)) throw new ValidationError('Planned date is not valid', 'date');
  const fields = {
    title: fd.get('title'),
    notes: fd.get('notes') || '',
    estimate: fd.get('estimate') === '' ? null : Number(fd.get('estimate')),
    priority: fd.get('priority') || 'med',
    projectId: fd.get('projectId') || null,
    objectiveId: fd.get('objectiveId') || null,
    dueDate: fd.get('dueDate') || null,
    tags: String(fd.get('tags') || '').split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean),
  };
  if (fd.has('dependsOn') || task?.dependsOn?.length) fields.dependsOn = fd.getAll('dependsOn');
  if (!String(fields.title || '').trim()) throw new ValidationError('Give the task a title', 'Task title');
  const rec = fd.has('repeat') ? readRecurrence(fd, plannedDate) : undefined;
  const wantWin = fd.get('dayWin') === 'on';
  let saved;
  if (!task) {
    saved = await createTask({ ...fields, plannedDate, ...(rec ? { recurrence: rec } : {}) });
    if (rec) {
      toast(`Repeating task created: ${describeRecurrence(saved.recurrence)}.`, { tone: 'success' });
      const occ = get('tasks', `${saved.id}~${plannedDate || todayKey()}`);
      if (wantWin && occ) await applyWin(occ, true);
      return saved;
    }
  } else if (task.kind === 'series') {
    saved = await updateTask(task.id, { ...fields, ...(rec ? { recurrence: rec } : {}) });
    return saved;
  } else {
    saved = await updateTask(task.id, { ...fields, plannedDate });
    if (rec && task.kind === 'single') {
      await makeRecurring(task.id, rec);
      toast('Task now repeats. Its history is kept on this first day.', { tone: 'success' });
    }
  }
  const cur = get('tasks', saved.id);
  await applyWin(cur, wantWin, task?.plannedDate);
  return cur;
}

async function applyWin(task, want, previousDate = null) {
  if (!task) return;
  if (previousDate && previousDate !== task.plannedDate && getPlan(previousDate).dayWinTaskId === task.id && !want) return;
  if (want) {
    if (!task.plannedDate) { toast('Plan the task for a day to make it that day’s Day Win.', { tone: 'info' }); return; }
    const { previous } = await setDayWin(task.plannedDate, task.id);
    if (previous) toast(`Day Win for ${relativeLabel(task.plannedDate)} changed from “${previous.title}”.`, { tone: 'win' });
  } else if (task.plannedDate && getPlan(task.plannedDate).dayWinTaskId === task.id) {
    await clearDayWin(task.plannedDate);
  }
}

// ---------- detail ----------
export function openTaskDetail(id, { tab = 'overview' } = {}) {
  const task = get('tasks', id);
  if (!task) { toast('That task no longer exists.', { tone: 'error' }); return null; }
  const m = openModal({ title: task.title, body: detailBody(task, tab), size: 'lg', className: 'task-detail',
    onMount(el) {
      el.addEventListener('click', (e) => {
        const tb = e.target.closest('[data-detail-tab]');
        if (tb) {
          qsa('[data-detail-tab]', el).forEach((b) => { b.setAttribute('aria-selected', String(b === tb)); b.classList.toggle('is-on', b === tb); });
          qsa('[data-detail-panel]', el).forEach((p) => { p.hidden = p.dataset.detailPanel !== tb.dataset.detailTab; });
        }
        if (e.target.closest('[data-action]')) setTimeout(() => { if (document.contains(el)) m.close(); }, 0);
      });
    } });
  return m;
}

function detailBody(t, tab) {
  const a = taskActual(t.id);
  const today = todayKey();
  const variance = t.estimate != null ? a.pomos - (t.originalEstimate ?? t.estimate) : null;
  const winDates = dayWinDatesFor(t.id);
  const statusLabel = { inbox: 'Inbox', planned: 'Planned', 'in-progress': 'In progress', completed: 'Completed', archived: 'Archived', active: 'Repeating' }[t.status];
  const blockers = blockingTasks(t);
  const deps = dependents(t.id);
  const facts = [
    ['Status', `<span class="status status--${t.status}">${statusLabel}</span>`],
    t.kind !== 'series' ? ['Planned for', t.plannedDate ? `${esc(formatLong(t.plannedDate))}` : 'Unscheduled'] : ['Repeats', esc(describeRecurrence(t.recurrence))],
    ['Priority', PRIORITY_LABEL[t.priority]],
    ['Project', projectChip(t.projectId) || '<span class="muted">None</span>'],
    ['Objective', objectiveChip(t.objectiveId) || '<span class="muted">None</span>'],
    t.dueDate ? ['Due', esc(formatLong(t.dueDate))] : null,
    t.tags?.length ? ['Tags', t.tags.map((g) => `<span class="tag">#${esc(g)}</span>`).join(' ')] : null,
    t.completedAt ? ['Completed', esc(fmtDateTime(t.completedAt))] : (t.completedDate ? ['Completed', esc(formatLong(t.completedDate))] : null),
    winDates.length ? ['Day Win', `${icon('starFill', { size: 13, cls: 'win-color' })} ${winDates.map((d) => esc(formatKey(d))).join(', ')}`] : null,
  ].filter(Boolean);
  const pva = `<div class="pva-cards">
    <div class="pva-card"><span class="pva-card__label">Planned</span><span class="pva-card__value">${t.originalEstimate ?? t.estimate ?? '—'}</span><span class="pva-card__sub">${t.estimate != null && t.originalEstimate != null && t.estimate !== t.originalEstimate ? `latest estimate ${t.estimate}` : 'Pomodoros'}</span></div>
    <div class="pva-card"><span class="pva-card__label">Actual</span><span class="pva-card__value">${a.pomos}</span><span class="pva-card__sub">${fmtDuration(a.minutes)} focused</span></div>
    <div class="pva-card"><span class="pva-card__label">Variance</span><span class="pva-card__value">${variance == null ? '—' : fmtSigned(variance)}</span><span class="pva-card__sub">${variance == null ? 'no estimate' : variance > 0 ? 'more than planned' : variance < 0 ? 'fewer than planned' : 'exactly as planned'}</span></div>
  </div>${t.estimateReliable === false ? `<p class="field__hint">${esc(t.estimateNote || '')} It is left out of planning accuracy by default.</p>` : ''}`;
  const sessions = a.sessions;
  const sessionList = sessions.length ? `<ul class="session-list">${sessions.slice(0, 100).map((s) => `<li class="session-item${s.completed ? '' : ' is-stopped'}"><span class="session-item__date">${esc(formatKey(s.date))}</span><span>${esc(sessionLabel(s))}</span><span class="muted">${s.startTime ? esc(fmtDateTime(s.startTime).split(', ').pop()) : (s.source === 'legacy' ? 'imported, no time' : '')}</span><span class="session-item__dur">${fmtDuration((s.actualDuration || 0) / 60)}</span></li>`).join('')}</ul>${sessions.length > 100 ? `<p class="muted">Showing 100 of ${sessions.length}. See History for all.</p>` : ''}`
    : emptyState({ icon: 'timer', title: 'No focus sessions yet', text: 'Select this task and start the timer — every finished Pomodoro is linked here.' });
  const hist = [];
  for (const e of t.estimateHistory || []) hist.push({ at: e.at, text: `Estimate set to ${e.value}${e.source === 'legacy' ? ' (imported from v1)' : e.source === 'series' ? ' (from repeating task)' : ''}` });
  for (const mv of t.moveHistory || []) hist.push({ at: mv.at, text: `Moved from ${mv.from ? formatKey(mv.from) : 'Unscheduled'} to ${mv.to ? formatKey(mv.to) : 'Unscheduled'}` });
  for (const p of state.dailyPlans.values()) for (const h of p.dayWinHistory || []) if (h.taskId === t.id) hist.push({ at: h.at, text: `Day Win for ${formatKey(p.date)}: ${h.action}` });
  for (const ev of state.activity.values()) if (ev.taskId === t.id) hist.push({ at: ev.ts, text: ev.note || 'Marked done' });
  if (t.createdAt) hist.push({ at: t.createdAt, text: t.legacy ? 'Created (imported from PomoFocus 1.x)' : 'Created' });
  hist.sort((x, y) => (y.at || 0) - (x.at || 0));
  const histList = `<ol class="timeline">${hist.map((h) => `<li><span class="timeline__when">${h.at ? esc(fmtDateTime(h.at)) : 'Unknown time'}</span><span>${esc(h.text)}</span></li>`).join('')}</ol>`;
  const open = isOpen(t);
  const actions = `<div class="detail-actions">
    ${t.kind !== 'series' ? (t.status === 'completed' ? `<button type="button" class="btn btn--secondary" data-action="task-toggle" data-id="${esc(t.id)}">${icon('undo', { size: 15 })}Reopen</button>`
    : open ? `<button type="button" class="btn btn--primary" data-action="task-toggle" data-id="${esc(t.id)}">${icon('check', { size: 15 })}Complete</button>
      <button type="button" class="btn btn--secondary" data-action="task-focus" data-id="${esc(t.id)}">${icon('play', { size: 15 })}Focus on this</button>
      <button type="button" class="btn btn--secondary" data-action="task-move" data-id="${esc(t.id)}">${icon('move', { size: 15 })}Move to another day</button>` : '') : ''}
    <button type="button" class="btn btn--secondary" data-action="task-edit" data-id="${esc(t.id)}">${icon('edit', { size: 15 })}Edit</button>
    <button type="button" class="btn btn--ghost" data-action="task-menu-more" data-id="${esc(t.id)}" ${t.plannedDate ? `data-date="${t.plannedDate}"` : ''}>${icon('more', { size: 15 })}More</button>
  </div>`;
  const tabs = [['overview', 'Overview'], ['sessions', `Sessions (${sessions.length})`], ['history', 'History']];
  return `${actions}
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" class="tab${k === tab ? ' is-on' : ''}" aria-selected="${k === tab}" data-detail-tab="${k}">${esc(l)}</button>`).join('')}</div>
    <div data-detail-panel="overview" ${tab === 'overview' ? '' : 'hidden'}>
      ${pva}
      <dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
      ${blockers.length ? `<div class="notice notice--warn">${icon('link', { size: 14 })} Waiting on: ${blockers.map((b) => `<button type="button" class="link-btn" data-action="task-open" data-id="${esc(b.id)}">${esc(b.title)}</button>`).join(', ')}</div>` : ''}
      ${deps.length ? `<p class="muted">Needed by: ${deps.map((d) => `<button type="button" class="link-btn" data-action="task-open" data-id="${esc(d.id)}">${esc(d.title)}</button>`).join(', ')}</p>` : ''}
      ${t.notes ? `<div class="notes">${esc(t.notes).replace(/\n/g, '<br>')}</div>` : ''}
      ${t.plannedDate && t.plannedDate < today && open ? `<p class="notice">This task was planned for ${esc(formatLong(t.plannedDate))} and is still open. It stays on that day as “Not completed” until you move it.</p>` : ''}
    </div>
    <div data-detail-panel="sessions" ${tab === 'sessions' ? '' : 'hidden'}>${sessionList}</div>
    <div data-detail-panel="history" ${tab === 'history' ? '' : 'hidden'}>${histList}</div>`;
}

// ---------- move ----------
export function openMoveDialog(taskId) {
  const t = get('tasks', taskId);
  if (!t) return null;
  const today = todayKey();
  const nextMon = addDays(startOfWeek(today, 1), 7);
  const choices = [[today, 'Today'], [addDays(today, 1), 'Tomorrow'], [nextMon, `Next ${formatKey(nextMon, { weekday: 'long' })}`]];
  const m = openModal({
    title: 'Move to another day', size: 'sm',
    subtitle: esc(t.title),
    body: `<form id="move-form" class="form">
      <div class="quick-dates quick-dates--stack">${choices.filter(([d]) => d !== t.plannedDate).map(([d, l]) => `<button type="button" class="btn btn--secondary btn--block" data-move-to="${d}">${esc(l)} <span class="muted">${esc(formatKey(d))}</span></button>`).join('')}
        ${t.plannedDate ? '<button type="button" class="btn btn--ghost btn--block" data-move-to="">Unschedule (back to inbox)</button>' : ''}</div>
      <div class="field"><label class="field__label" for="move-date">Or pick a date</label><input id="move-date" type="date" class="input" name="date" value="${esc(t.plannedDate || addDays(today, 1))}"></div>
      ${t.plannedDate ? `<p class="field__hint">${esc(formatKey(t.plannedDate))} will still show this task as “Moved”, so the history of that day stays accurate.</p>` : ''}
    </form>`,
    footer: '<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="move-form" class="btn btn--primary">Move</button>',
    onMount(el, close) {
      const go = async (date) => {
        try {
          const wasWin = t.plannedDate && getPlan(t.plannedDate).dayWinTaskId === t.id;
          await moveTask(t.id, date || null);
          close(date);
          toast(date ? `Moved to ${relativeLabel(date)}.` : 'Moved to the inbox.', { tone: 'success' });
          if (wasWin) toast('It stays recorded as that day’s Day Win (moved, not completed).', { tone: 'info' });
        } catch (err) { errorToast(err); }
      };
      el.addEventListener('click', (e) => { const b = e.target.closest('[data-move-to]'); if (b) go(b.dataset.moveTo); });
      qs('#move-form', el).addEventListener('submit', (e) => { e.preventDefault(); go(e.target.date.value); });
    },
  });
  return m.result;
}

// ---------- picker ----------
/** Choose a task from a list. Resolves to a task id or null. */
export function pickTask({ title = 'Choose a task', tasks, emptyText = 'No tasks to choose from.', hint = '', allowCreate = null } = {}) {
  const list = tasks || openTasks();
  const render = (q) => {
    const items = q ? list.filter((t) => t.title.toLowerCase().includes(q.toLowerCase())) : list;
    if (!items.length) return `<p class="muted pick-empty">${esc(q ? 'No matching tasks.' : emptyText)}</p>`;
    return items.slice(0, 80).map((t) => `<button type="button" class="pick-item" data-pick="${esc(t.id)}"><span class="pick-item__title">${esc(t.title)}</span><span class="pick-item__meta">${projectChip(t.projectId)}${t.plannedDate ? `<span class="meta-item">${esc(relativeLabel(t.plannedDate))}</span>` : ''}${pips(taskActual(t.id).pomos, t.estimate)}</span></button>`).join('');
  };
  const m = openModal({
    title, size: 'md',
    body: `${hint ? `<p class="muted">${hint}</p>` : ''}<input type="search" class="input" placeholder="Search tasks…" data-pick-search aria-label="Search tasks" autofocus>
      <div class="pick-list" data-pick-list>${render('')}</div>
      ${allowCreate ? '<button type="button" class="btn btn--ghost btn--block" data-pick-create>' + icon('plus', { size: 15 }) + 'New task…</button>' : ''}`,
    onMount(el, close) {
      const input = qs('[data-pick-search]', el);
      const listEl = qs('[data-pick-list]', el);
      input.addEventListener('input', () => { listEl.innerHTML = render(input.value.trim()); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const first = qs('[data-pick]', listEl); if (first) { e.preventDefault(); close(first.dataset.pick); } }
        if (e.key === 'ArrowDown') { e.preventDefault(); qs('[data-pick]', listEl)?.focus(); }
      });
      listEl.addEventListener('keydown', (e) => {
        const items = qsa('[data-pick]', listEl); const i = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(items.length - 1, i + 1)]?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) input.focus(); else items[i - 1].focus(); }
      });
      el.addEventListener('click', (e) => {
        const b = e.target.closest('[data-pick]'); if (b) close(b.dataset.pick);
        if (e.target.closest('[data-pick-create]')) { close(null); allowCreate(); }
      });
    },
  });
  return m.result;
}

export { searchTasks };
