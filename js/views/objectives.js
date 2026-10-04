/** Objectives — outcomes that span tasks and days. Progress is derived from tasks. */
import { state, get, all } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { todayKey, formatLong, formatKey, rangeKeys, addDays, keyFromTs } from '../utils/dates.js';
import { fmtDuration, plural, fmtPct } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { taskRow, progressBar, emptyState, sectionHead, projectChip, projectOptions, options, segmented } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { navigate, setQuery } from '../ui/router.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, undoToast } from '../ui/toast.js';
import { chart } from '../ui/charts.js';
import { registerList } from '../ui/handlers.js';
import { registerSortable } from '../ui/dnd.js';
import { listObjectives, objectiveTasks, objectiveProgress, createObjective, updateObjective, deleteObjective, setObjectiveStatus, setObjectiveOrder } from '../features/objectives.js';
import { isCountedFocus } from '../features/sessions.js';
import { quickAddForm } from './today.js';

export const title = 'Objectives';
const STATUS_LABEL = { active: 'Active', paused: 'Paused', completed: 'Completed', archived: 'Archived' };

function objectiveCard(o) {
  const p = objectiveProgress(o.id);
  const today = todayKey();
  const overdue = o.targetDate && o.targetDate < today && o.status === 'active';
  return `<li class="objective-card card status-${o.status}" ${o.status === 'active' ? 'data-sort-item' : ''} data-id="${esc(o.id)}">
    ${o.status === 'active' ? `<span class="drag-handle" aria-hidden="true">${icon('grip', { size: 16 })}</span>` : ''}
    <div class="objective-card__body">
      <div class="objective-card__top"><a class="objective-card__title" href="#/objectives/${esc(o.id)}">${esc(o.title)}</a>
        ${o.status !== 'active' ? `<span class="status status--${o.status}">${STATUS_LABEL[o.status]}</span>` : ''}</div>
      <div class="objective-card__meta">${projectChip(o.projectId)}${o.targetDate ? `<span class="meta-item${overdue ? ' is-past' : ''}">${icon('calendar', { size: 12 })}Target ${esc(formatKey(o.targetDate, { month: 'short', day: 'numeric' }))}</span>` : ''}<span class="meta-item">${o.completionRule === 'all-tasks' ? 'Completes with its tasks' : 'Completed manually'}</span></div>
      ${progressBar(p.ratio, { label: `${o.title}: ${p.done} of ${p.total} tasks`, tone: o.status === 'completed' ? 'ok' : 'secondary' })}
      <div class="objective-card__stats"><span><strong>${p.done}</strong>/${p.total} tasks</span><span><strong>${p.actualPomos}</strong>${p.plannedPomos ? `/${p.plannedPomos}` : ''} Pomodoros</span><span>${fmtDuration(p.focusMin)} focus</span>${p.activeDays ? `<span>${plural(p.activeDays, 'active day')}</span>` : ''}</div>
    </div>
  </li>`;
}

function listView(q) {
  const filter = q.status || 'active';
  const list = listObjectives({ status: filter === 'all' ? null : filter });
  return `<div class="page page--objectives">
    <header class="page-head"><div><h1 class="page-title">Objectives</h1><p class="page-head__sub">Bigger outcomes that your tasks move forward.</p></div>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" data-action="objective-new">${icon('plus', { size: 15 })}New objective</button></div></header>
    ${segmented([{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }], filter, { action: 'objectives-filter', label: 'Filter objectives' })}
    ${list.length ? `<ul class="objective-list" ${filter === 'active' ? 'data-sortable="objectives"' : ''}>${list.map(objectiveCard).join('')}</ul>`
    : emptyState({ icon: 'target', title: filter === 'active' ? 'No active objectives' : 'Nothing here', text: filter === 'active' ? 'An objective is an outcome like “Finish chapter 4” or “Ship the beta”. Link tasks to it and its progress fills in by itself.' : '', action: filter === 'active' ? '<button type="button" class="btn btn--primary" data-action="objective-new">Create an objective</button>' : '' })}
  </div>`;
}

function detailView(o) {
  const p = objectiveProgress(o.id);
  const tasks = objectiveTasks(o.id);
  const open = tasks.filter((t) => t.status !== 'completed' && t.status !== 'archived');
  const done = tasks.filter((t) => t.status === 'completed');
  const listKey = registerList(`obj-${o.id}`, open.map((t) => t.id));
  // focus per day for the objective
  const days = new Map();
  for (const s of state.sessions.values()) if (s.objectiveId === o.id && isCountedFocus(s)) days.set(s.date, (days.get(s.date) || 0) + (s.actualDuration || 0) / 60);
  const keys = [...days.keys()].sort();
  const start = keys[0] || todayKey();
  const span = rangeKeys(start < addDays(todayKey(), -29) ? start : addDays(todayKey(), -29), todayKey());
  const byWeek = span.length > 60;
  const series = span.map((k) => days.get(k) || 0);
  return `<div class="page page--objective">
    <nav class="breadcrumb"><a href="#/objectives">${icon('chevLeft', { size: 14 })}Objectives</a></nav>
    <header class="page-head"><div><h1 class="page-title">${esc(o.title)}</h1>
      <div class="page-head__meta"><span class="status status--${o.status}">${STATUS_LABEL[o.status]}</span>${projectChip(o.projectId)}${o.startDate ? `<span class="meta-item">From ${esc(formatKey(o.startDate))}</span>` : ''}${o.targetDate ? `<span class="meta-item">Target ${esc(formatLong(o.targetDate))}</span>` : ''}</div></div>
      <div class="page-head__actions">
        ${o.status === 'active' ? `<button type="button" class="btn btn--secondary" data-action="objective-status" data-id="${esc(o.id)}" data-value="completed">${icon('check', { size: 15 })}Mark completed</button>` : ''}
        ${o.status === 'completed' || o.status === 'paused' || o.status === 'archived' ? `<button type="button" class="btn btn--secondary" data-action="objective-status" data-id="${esc(o.id)}" data-value="active">Reactivate</button>` : ''}
        <button type="button" class="btn btn--ghost" data-action="objective-edit" data-id="${esc(o.id)}">${icon('edit', { size: 15 })}Edit</button>
        <button type="button" class="icon-btn" data-action="objective-menu" data-id="${esc(o.id)}" aria-label="More actions">${icon('more')}</button>
      </div></header>
    ${o.description ? `<p class="lead">${esc(o.description)}</p>` : ''}
    <div class="stat-row">
      <div class="stat"><span class="stat__value">${fmtPct(p.ratio)}</span><span class="stat__label">Tasks completed</span><span class="stat__sub">${p.done} of ${p.total}</span></div>
      <div class="stat"><span class="stat__value">${p.actualPomos}${p.plannedPomos ? `<small>/${p.plannedPomos}</small>` : ''}</span><span class="stat__label">Pomodoros, actual / planned</span></div>
      <div class="stat"><span class="stat__value">${fmtDuration(p.focusMin)}</span><span class="stat__label">Focus time</span></div>
      <div class="stat"><span class="stat__value">${p.activeDays}</span><span class="stat__label">Days worked</span><span class="stat__sub">${p.plannedDays} planned</span></div>
    </div>
    ${progressBar(p.ratio, { label: 'Objective progress', tone: 'secondary', size: 'lg' })}
    <div class="two-col">
      <section class="card">${sectionHead('Open tasks', { level: 2, count: open.length })}
        ${quickAddForm(null, { placeholder: 'Add a task to this objective (@today to plan it)…', objectiveId: o.id, projectId: o.projectId || '' })}
        ${open.length ? `<ul class="task-list" data-sortable="tasks">${open.map((t) => taskRow(t, { showDate: true, sortable: true, listKey, allowWin: false })).join('')}</ul>` : '<p class="muted">No open tasks.</p>'}
        ${done.length ? `<details class="done-group"><summary>Completed <span class="count">${done.length}</span></summary><ul class="task-list">${done.map((t) => taskRow(t, { showDate: true, allowWin: false })).join('')}</ul></details>` : ''}
      </section>
      <section class="card">${sectionHead('Focus over time', { level: 2 })}
        ${keys.length ? chart({ type: 'bar', height: 180, label: 'Focus minutes per day for this objective', labels: span.map((k) => formatKey(k, { month: 'short', day: 'numeric' })), series: [{ name: 'Focus', values: series, color: 'var(--chart-2)' }], yFormat: (v) => fmtDuration(v, { compact: true }), yUnit: 'minutes', tip: (i) => `${formatKey(span[i])}\n${fmtDuration(series[i])} focus`, table: { head: ['Date', 'Focus'], rows: keys.map((k) => [k, fmtDuration(days.get(k))]) } }) + (byWeek ? '' : '')
    : '<p class="muted">Focus sessions on this objective’s tasks will appear here.</p>'}
        ${o.notes ? `<h3 class="sub-title">Notes</h3><div class="notes">${esc(o.notes).replace(/\n/g, '<br>')}</div>` : ''}
      </section>
    </div>
  </div>`;
}

export function render(route) {
  if (route.parts[0]) {
    const o = get('objectives', route.parts[0]);
    if (o) return detailView(o);
    return `<div class="page">${emptyState({ icon: 'target', title: 'Objective not found', text: 'It may have been deleted.', action: '<a class="btn btn--secondary" href="#/objectives">All objectives</a>' })}</div>`;
  }
  return listView(route.query);
}

export function openObjectiveForm(o = null) {
  const x = o || {};
  const m = openModal({
    title: o ? 'Edit objective' : 'New objective', size: 'md',
    body: `<form id="obj-form" class="form" novalidate>
      <div class="field"><label class="field__label" for="of-title">Objective</label><input id="of-title" name="title" class="input input--large" required maxlength="200" value="${esc(x.title || '')}" placeholder="e.g. Finish the ML course" autofocus></div>
      <div class="field"><label class="field__label" for="of-desc">Description <span class="optional">optional</span></label><textarea id="of-desc" name="description" class="input" rows="2">${esc(x.description || '')}</textarea></div>
      <div class="form-grid">
        <div class="field"><label class="field__label" for="of-proj">Project</label><select id="of-proj" name="projectId" class="input">${projectOptions(x.projectId || null)}</select></div>
        <div class="field"><label class="field__label" for="of-prio">Priority</label><select id="of-prio" name="priority" class="input">${options([{ value: 'high', label: 'High' }, { value: 'med', label: 'Medium' }, { value: 'low', label: 'Low' }], x.priority || 'med')}</select></div>
        <div class="field"><label class="field__label" for="of-start">Start date</label><input id="of-start" type="date" name="startDate" class="input" value="${esc(x.startDate || '')}"></div>
        <div class="field"><label class="field__label" for="of-target">Target date</label><input id="of-target" type="date" name="targetDate" class="input" value="${esc(x.targetDate || '')}"></div>
      </div>
      <fieldset class="field"><legend class="field__label">Completion</legend>
        <label class="check-row"><input type="radio" name="completionRule" value="manual" ${(x.completionRule || 'manual') === 'manual' ? 'checked' : ''}> I’ll mark it completed myself</label>
        <label class="check-row"><input type="radio" name="completionRule" value="all-tasks" ${x.completionRule === 'all-tasks' ? 'checked' : ''}> Complete it automatically when all its tasks are done</label></fieldset>
      <div class="field"><label class="field__label" for="of-notes">Notes</label><textarea id="of-notes" name="notes" class="input" rows="3">${esc(x.notes || '')}</textarea></div>
      <p class="form-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="obj-form" class="btn btn--primary">${o ? 'Save' : 'Create objective'}</button>`,
    onMount(el, close) {
      qs('#obj-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const fields = Object.fromEntries(['title', 'description', 'projectId', 'priority', 'startDate', 'targetDate', 'completionRule', 'notes'].map((k) => [k, fd.get(k) || (k === 'projectId' || k.endsWith('Date') ? null : '')]));
        try {
          if (fields.startDate && fields.targetDate && fields.targetDate < fields.startDate) throw new Error('The target date is before the start date.');
          const rec = o ? await updateObjective(o.id, fields) : await createObjective(fields);
          close(rec);
          toast(o ? 'Objective saved.' : 'Objective created.', { tone: 'success' });
          if (!o) navigate(`#/objectives/${rec.id}`);
        } catch (err) { const box = qs('.form-error', el); box.textContent = err.message; box.hidden = false; }
      });
    },
  });
  return m.result;
}

registerSortable('objectives', (ids) => setObjectiveOrder(ids));
registerActions({
  'objective-new': () => openObjectiveForm(),
  'objective-edit': (el) => openObjectiveForm(get('objectives', el.dataset.id)),
  'objectives-filter': (el) => setQuery({ status: el.dataset.value }),
  'objective-status': async (el) => {
    await setObjectiveStatus(el.dataset.id, el.dataset.value);
    toast(el.dataset.value === 'completed' ? 'Objective completed.' : `Objective ${STATUS_LABEL[el.dataset.value].toLowerCase()}.`, { tone: 'success' });
  },
  'objective-menu': async (el) => {
    const { openMenu } = await import('../ui/components.js');
    const o = get('objectives', el.dataset.id);
    openMenu(el, [
      o.status === 'active' ? { label: 'Pause', icon: 'pause', action: 'objective-status', data: { id: o.id, value: 'paused' } } : null,
      o.status !== 'archived' ? { label: 'Archive', icon: 'archive', action: 'objective-status', data: { id: o.id, value: 'archived' } } : null,
      { label: 'Delete', icon: 'trash', action: 'objective-delete', data: { id: o.id }, danger: true },
    ]);
  },
  'objective-delete': async (el) => {
    const o = get('objectives', el.dataset.id);
    const n = objectiveTasks(o.id).length;
    if (!await confirmDialog({ title: 'Delete objective?', danger: true, confirmLabel: 'Delete', message: `“${o.title}” will be deleted. ${n ? `Its ${n} task${n === 1 ? '' : 's'} and their focus history are kept, just unlinked.` : ''}` })) return;
    const inv = await deleteObjective(o.id);
    navigate('#/objectives');
    undoToast('Objective deleted.', inv);
  },
});

export { all, keyFromTs };
