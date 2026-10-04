/** Reusable HTML builders. Every piece of user text goes through esc(). */
import { state, get } from '../core/state.js';
import { esc, attrs } from '../utils/dom.js';
import { icon } from './icons.js';
import { fmtDuration, PRIORITY_LABEL } from '../utils/format.js';
import { formatKey, relativeLabel, todayKey } from '../utils/dates.js';
import { taskActual } from '../features/sessions.js';
import { dayStatus, blockingTasks, describeRecurrence } from '../features/tasks.js';
import { getPlan } from '../features/daily-plan.js';
import { activeTaskId } from '../features/timer.js';

export function pips(actual, estimate, { max = 10 } = {}) {
  const est = estimate ?? 0;
  const label = estimate == null ? `${actual} Pomodoro${actual === 1 ? '' : 's'}, no estimate` : `${actual} of ${est} Pomodoros`;
  if (estimate == null || est > max || actual > max) {
    return `<span class="pomo-count" title="${label}" aria-label="${label}">${actual}${estimate != null ? `<span class="pomo-count__of">/${est}</span>` : ''}</span>`;
  }
  let out = '';
  const n = Math.max(est, actual);
  for (let i = 0; i < n; i++) {
    const cls = i < actual ? (i >= est ? 'pip is-over' : 'pip is-done') : 'pip';
    out += `<span class="${cls}"></span>`;
  }
  return `<span class="pips" title="${label}" role="img" aria-label="${label}">${out}</span>`;
}

export function projectChip(projectId, { compact = false } = {}) {
  const p = projectId ? get('projects', projectId) : null;
  if (!p) return '';
  return `<span class="chip chip--project${p.archived ? ' is-archived' : ''}" style="--chip:${esc(p.color)}"><span class="chip__dot"></span>${compact ? '' : esc(p.name)}</span>`;
}

export function objectiveChip(objectiveId) {
  const o = objectiveId ? get('objectives', objectiveId) : null;
  if (!o) return '';
  return `<a class="chip chip--objective" href="#/objectives/${esc(o.id)}">${icon('target', { size: 12 })}${esc(o.title)}</a>`;
}

export function priorityBadge(p) {
  if (p === 'low') return '';
  return `<span class="prio prio--${p}" title="${PRIORITY_LABEL[p]} priority">${p === 'high' ? 'High' : 'Med'}</span>`;
}

/**
 * One task row.
 * ctx: { date, sortable, showDate, list (ordered ids for nudge), compact, allowWin }
 */
export function taskRow(task, ctx = {}) {
  const today = todayKey();
  const date = ctx.date ?? task.plannedDate;
  const a = taskActual(task.id);
  const done = task.status === 'completed';
  const archived = task.status === 'archived';
  const st = date ? dayStatus(task, date, today) : null;
  const moved = st?.key === 'moved';
  const isWin = !!date && getPlan(date).dayWinTaskId === task.id;
  const isActive = activeTaskId() === task.id;
  const blockers = blockingTasks(task);
  const meta = [];
  meta.push(priorityBadge(task.priority));
  meta.push(projectChip(task.projectId));
  if (task.objectiveId) meta.push(objectiveChip(task.objectiveId));
  if (task.kind === 'occurrence') meta.push(`<span class="meta-item" title="Repeats">${icon('repeat', { size: 12 })}</span>`);
  if (task.kind === 'series') meta.push(`<span class="meta-item">${icon('repeat', { size: 12 })}${esc(describeRecurrence(task.recurrence))}</span>`);
  if (ctx.showDate && task.plannedDate) meta.push(`<span class="meta-item${task.plannedDate < today && !done ? ' is-past' : ''}">${icon('calendar', { size: 12 })}${esc(relativeLabel(task.plannedDate, today))}</span>`);
  if (ctx.showDate && !task.plannedDate && task.kind !== 'series' && !done && !archived) meta.push(`<span class="meta-item">${icon('inbox', { size: 12 })}Unscheduled</span>`);
  if (task.dueDate) meta.push(`<span class="meta-item${task.dueDate < today && !done ? ' is-past' : ''}">Due ${esc(formatKey(task.dueDate, { month: 'short', day: 'numeric' }))}</span>`);
  if (moved) meta.push(`<span class="meta-item is-moved">${icon('move', { size: 12 })}${st.to ? `Moved to ${esc(formatKey(st.to, { month: 'short', day: 'numeric' }))}` : 'Unscheduled'}</span>`);
  if (st?.key === 'incomplete') meta.push('<span class="meta-item is-neutral">Not completed</span>');
  if (done && task.completedDate && date && task.completedDate > date) meta.push(`<span class="meta-item">Completed ${esc(formatKey(task.completedDate, { month: 'short', day: 'numeric' }))}</span>`);
  if (blockers.length) meta.push(`<span class="meta-item is-warn" title="Waiting on: ${esc(blockers.map((b) => b.title).join(', '))}">${icon('link', { size: 12 })}Depends on ${blockers.length}</span>`);
  for (const tag of (task.tags || []).slice(0, 3)) meta.push(`<span class="tag">#${esc(tag)}</span>`);
  const canAct = !moved && !archived && task.kind !== 'series';
  const cls = ['task-row', done && 'is-done', isActive && 'is-active', isWin && 'is-win', moved && 'is-moved', archived && 'is-archived', `prio-${task.priority}`].filter(Boolean).join(' ');
  return `<li class="${cls}" data-id="${esc(task.id)}" ${ctx.sortable && canAct ? 'data-sort-item' : ''}>
    ${ctx.sortable && canAct ? `<span class="drag-handle" title="Drag to reorder (or Alt+↑/↓)" aria-hidden="true">${icon('grip', { size: 16 })}</span>` : ''}
    ${task.kind === 'series' ? `<span class="check check--static">${icon('repeat', { size: 14 })}</span>` : `<button type="button" class="check${done ? ' is-checked' : ''}" data-action="task-toggle" data-id="${esc(task.id)}" aria-pressed="${done}" aria-label="${done ? 'Mark as not completed' : 'Mark as completed'}: ${esc(task.title)}" ${moved || archived ? 'disabled' : ''}>${icon('check', { size: 14 })}</button>`}
    <div class="task-row__main">
      <button type="button" class="task-row__title" data-action="task-open" data-id="${esc(task.id)}">${isWin ? `<span class="win-mark" title="Day Win">${icon('starFill', { size: 13 })}</span>` : ''}${esc(task.title)}</button>
      ${meta.filter(Boolean).length ? `<div class="task-row__meta">${meta.filter(Boolean).join('')}</div>` : ''}
    </div>
    ${ctx.extra ? ctx.extra(task) : `<div class="task-row__pomos">${pips(a.pomos, task.estimate)}</div>`}
    <div class="task-row__actions">
      ${canAct && ctx.allowWin !== false && date && !done ? `<button type="button" class="icon-btn win-toggle${isWin ? ' is-on' : ''}" data-action="daywin-toggle" data-id="${esc(task.id)}" data-date="${esc(date)}" aria-pressed="${isWin}" aria-label="${isWin ? 'Remove as Day Win' : 'Make this the Day Win'}" title="${isWin ? 'Day Win' : 'Make Day Win'}">${icon(isWin ? 'starFill' : 'star', { size: 16 })}</button>` : ''}
      ${canAct && !done ? `<button type="button" class="icon-btn focus-btn${isActive ? ' is-on' : ''}" data-action="task-focus" data-id="${esc(task.id)}" aria-label="${isActive ? 'Current focus' : 'Focus on this task'}" title="${isActive ? 'Current focus' : 'Focus on this'}">${icon(isActive ? 'timer' : 'play', { size: 15 })}</button>` : ''}
      <button type="button" class="icon-btn" data-action="task-menu" data-id="${esc(task.id)}" ${date ? `data-date="${esc(date)}"` : ''} ${ctx.listKey ? `data-list="${esc(ctx.listKey)}"` : ''} aria-label="More actions for ${esc(task.title)}" aria-haspopup="menu">${icon('more', { size: 16 })}</button>
    </div>
  </li>`;
}

export function progressBar(ratio, { label = '', tone = 'accent', size = 'md' } = {}) {
  const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
  return `<div class="bar bar--${size} bar--${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" ${label ? `aria-label="${esc(label)}"` : ''}><span style="width:${pct}%"></span></div>`;
}

export function emptyState({ icon: ic = 'info', title, text = '', action = '' }) {
  return `<div class="empty">${icon(ic, { size: 28, cls: 'empty__icon' })}<p class="empty__title">${esc(title)}</p>${text ? `<p class="empty__text">${text}</p>` : ''}${action}</div>`;
}

export function stat({ label, value, sub = '', tone = '' }) {
  return `<div class="stat ${tone ? `stat--${tone}` : ''}"><span class="stat__value">${value}</span><span class="stat__label">${esc(label)}</span>${sub ? `<span class="stat__sub">${sub}</span>` : ''}</div>`;
}

export function segmented(options, value, { action, name = '', label = '' } = {}) {
  return `<div class="segmented" role="group" ${label ? `aria-label="${esc(label)}"` : ''}>${options.map((o) =>
    `<button type="button" class="segmented__btn${o.value === value ? ' is-on' : ''}" aria-pressed="${o.value === value}" data-action="${esc(action)}" data-value="${esc(o.value)}" ${name ? `data-name="${esc(name)}"` : ''}>${esc(o.label)}</button>`).join('')}</div>`;
}

export function sectionHead(title, { count = null, actions = '', level = 2, id = '' } = {}) {
  return `<div class="section-head"><h${level} class="section-title" ${id ? `id="${id}"` : ''}>${esc(title)}${count != null ? ` <span class="count">${count}</span>` : ''}</h${level}>${actions ? `<div class="section-head__actions">${actions}</div>` : ''}</div>`;
}

export function projectOptions(selected, { includeNone = true, includeArchived = false, noneLabel = 'No project' } = {}) {
  const list = [...state.projects.values()].filter((p) => includeArchived || !p.archived || p.id === selected)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return `${includeNone ? `<option value="">${esc(noneLabel)}</option>` : ''}${list.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)}${p.archived ? ' (archived)' : ''}</option>`).join('')}`;
}

export function objectiveOptions(selected, { includeNone = true, noneLabel = 'No objective' } = {}) {
  const list = [...state.objectives.values()].filter((o) => o.status === 'active' || o.status === 'paused' || o.id === selected)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return `${includeNone ? `<option value="">${esc(noneLabel)}</option>` : ''}${list.map((o) => `<option value="${esc(o.id)}" ${o.id === selected ? 'selected' : ''}>${esc(o.title)}</option>`).join('')}`;
}

export function options(list, selected) {
  return list.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
}

export function field({ label, html, hint = '', id = '', cls = '' }) {
  return `<div class="field ${cls}">${label ? `<label class="field__label" ${id ? `for="${id}"` : ''}>${esc(label)}</label>` : ''}${html}${hint ? `<p class="field__hint">${hint}</p>` : ''}</div>`;
}

export function toggle({ name, checked, label, hint = '', action = '', data = {} }) {
  return `<label class="switch-row"><span class="switch-row__text"><span class="switch-row__label">${esc(label)}</span>${hint ? `<span class="switch-row__hint">${hint}</span>` : ''}</span>
    <input type="checkbox" class="switch" name="${esc(name)}" ${checked ? 'checked' : ''} ${action ? `data-change="${esc(action)}"` : ''} ${attrs(data)}></label>`;
}

export function focusMinutes(min) { return fmtDuration(min); }

// ---------- popover menu ----------
let openMenuEl = null;

/** items: [{label, icon, action, data:{}, danger, divider}] — items reuse the global data-action delegation. */
export function openMenu(anchor, items, { label = 'Actions' } = {}) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', label);
  menu.innerHTML = items.filter(Boolean).map((it) => it.divider ? '<div class="menu__sep" role="separator"></div>'
    : `<button type="button" role="menuitem" class="menu__item${it.danger ? ' is-danger' : ''}" data-action="${esc(it.action)}" ${attrs(Object.fromEntries(Object.entries(it.data || {}).map(([k, v]) => [`data-${k}`, v])))} ${it.disabled ? 'disabled' : ''}>${it.icon ? icon(it.icon, { size: 15 }) : '<span class="menu__noicon"></span>'}<span>${esc(it.label)}</span>${it.hint ? `<kbd>${esc(it.hint)}</kbd>` : ''}</button>`).join('');
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth; const mh = menu.offsetHeight;
  let left = Math.min(window.innerWidth - mw - 8, Math.max(8, r.right - mw));
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = `${left}px`; menu.style.top = `${top}px`;
  openMenuEl = { menu, anchor };
  anchor.setAttribute('aria-expanded', 'true');
  const btns = [...menu.querySelectorAll('.menu__item:not([disabled])')];
  btns[0]?.focus();
  menu.addEventListener('keydown', (e) => {
    const i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
    else if (e.key === 'Tab') closeMenu();
  });
  menu.addEventListener('click', (e) => { if (e.target.closest('.menu__item')) setTimeout(() => closeMenu(), 0); });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
}

function outside(e) {
  if (openMenuEl && !openMenuEl.menu.contains(e.target)) closeMenu();
}

export function closeMenu(refocus = false) {
  if (!openMenuEl) return false;
  const { menu, anchor } = openMenuEl;
  openMenuEl = null;
  menu.remove();
  anchor.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', outside, true);
  if (refocus && document.contains(anchor)) anchor.focus();
  return true;
}

export function menuOpen() { return !!openMenuEl; }
