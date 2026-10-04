/** Tasks — every task, with search, filters and sorting. */
import { state, all, get } from '../core/state.js';
import { esc } from '../utils/dom.js';
import { todayKey } from '../utils/dates.js';
import { icon } from '../ui/icons.js';
import { taskRow, emptyState, projectOptions, objectiveOptions, options } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { setQuery } from '../ui/router.js';
import { registerList } from '../ui/handlers.js';
import { byOrder, byPriority, isOpen, allTags, describeRecurrence, taskActual } from '../features/tasks.js';
import { getPlan } from '../features/daily-plan.js';
import { quickAddForm } from './today.js';

export const title = 'Tasks';

const STATUS = [
  { value: 'open', label: 'Open' }, { value: 'inbox', label: 'Inbox' }, { value: 'planned', label: 'Planned' },
  { value: 'in-progress', label: 'In progress' }, { value: 'completed', label: 'Completed' }, { value: 'archived', label: 'Archived' },
  { value: 'recurring', label: 'Repeating' }, { value: 'all', label: 'All' },
];
const WHEN = [
  { value: '', label: 'Any day' }, { value: 'today', label: 'Today' }, { value: 'overdue', label: 'Earlier, unfinished' },
  { value: 'upcoming', label: 'Upcoming' }, { value: 'unscheduled', label: 'Unscheduled' },
];
const SORT = [
  { value: 'order', label: 'Plan order' }, { value: 'priority', label: 'Priority' }, { value: 'date', label: 'Planned date' },
  { value: 'created', label: 'Newest first' }, { value: 'updated', label: 'Recently changed' }, { value: 'title', label: 'Title' },
  { value: 'effort', label: 'Most focus' },
];

export function filterTasks(q) {
  const today = todayKey();
  const status = q.status || (q.when === 'overdue' ? 'open' : 'open');
  let list = all('tasks');
  if (status === 'recurring') list = list.filter((t) => t.kind === 'series');
  else {
    list = list.filter((t) => t.kind !== 'series');
    if (status === 'open') list = list.filter(isOpen);
    else if (status !== 'all') list = list.filter((t) => t.status === status);
  }
  if (q.when === 'today') list = list.filter((t) => t.plannedDate === today);
  if (q.when === 'overdue') list = list.filter((t) => isOpen(t) && t.plannedDate && t.plannedDate < today);
  if (q.when === 'upcoming') list = list.filter((t) => t.plannedDate && t.plannedDate > today);
  if (q.when === 'unscheduled') list = list.filter((t) => !t.plannedDate && t.kind !== 'series');
  if (q.project === '_none') list = list.filter((t) => !t.projectId);
  else if (q.project) list = list.filter((t) => t.projectId === q.project);
  if (q.objective === '_none') list = list.filter((t) => !t.objectiveId);
  else if (q.objective) list = list.filter((t) => t.objectiveId === q.objective);
  if (q.priority) list = list.filter((t) => t.priority === q.priority);
  if (q.tag) list = list.filter((t) => t.tags?.includes(q.tag));
  if (q.win === '1') list = list.filter((t) => t.plannedDate && getPlan(t.plannedDate).dayWinTaskId === t.id);
  if (q.q) {
    const s = q.q.toLowerCase();
    list = list.filter((t) => t.title.toLowerCase().includes(s) || t.notes?.toLowerCase().includes(s) || t.tags?.some((g) => g.includes(s)));
  }
  const sort = q.sort || (status === 'completed' ? 'updated' : 'date');
  const cmp = {
    order: byOrder,
    priority: byPriority,
    date: (a, b) => (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999') || byOrder(a, b),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    updated: (a, b) => (b.completedAt || b.updatedAt || 0) - (a.completedAt || a.updatedAt || 0),
    title: (a, b) => a.title.localeCompare(b.title),
    effort: (a, b) => taskActual(b.id).pomos - taskActual(a.id).pomos,
  }[sort] || byOrder;
  return list.sort(cmp);
}

export function render(route) {
  const q = route.query;
  const status = q.status || 'open';
  const list = filterTasks(q);
  const limit = Number(q.limit) || 150;
  const tags = allTags();
  const filtered = ['when', 'project', 'objective', 'priority', 'tag', 'q', 'win'].some((k) => q[k]);
  const listKey = registerList('tasks-view', list.map((t) => t.id));
  const counts = {
    open: all('tasks').filter((t) => t.kind !== 'series' && isOpen(t)).length,
  };
  return `<div class="page page--tasks">
    <header class="page-head"><div><h1 class="page-title">Tasks</h1><p class="page-head__sub">${counts.open} open across all days</p></div>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" data-action="new-task" data-date="">${icon('plus', { size: 15 })}New task</button></div></header>
    <div class="status-tabs" role="tablist" aria-label="Task status">${STATUS.map((s) => `<button type="button" role="tab" class="tab${s.value === status ? ' is-on' : ''}" aria-selected="${s.value === status}" data-action="tasks-filter" data-name="status" data-value="${s.value}">${esc(s.label)}</button>`).join('')}</div>
    <div class="filter-bar card">
      <div class="search-field">${icon('search', { size: 16 })}<input type="search" class="input" placeholder="Search titles, notes, tags…" value="${esc(q.q || '')}" data-change="tasks-search" data-input="tasks-search-live" aria-label="Search tasks" id="tasks-search"></div>
      ${status !== 'recurring' ? `<label class="filter"><span class="sr-only">When</span><select class="input input--small" data-change="tasks-filter-select" data-name="when" aria-label="When">${options(WHEN, q.when || '')}</select></label>` : ''}
      <label class="filter"><span class="sr-only">Project</span><select class="input input--small" data-change="tasks-filter-select" data-name="project" aria-label="Project"><option value="">All projects</option><option value="_none" ${q.project === '_none' ? 'selected' : ''}>No project</option>${projectOptions(q.project, { includeNone: false, includeArchived: true })}</select></label>
      <label class="filter"><span class="sr-only">Objective</span><select class="input input--small" data-change="tasks-filter-select" data-name="objective" aria-label="Objective"><option value="">All objectives</option><option value="_none" ${q.objective === '_none' ? 'selected' : ''}>No objective</option>${objectiveOptions(q.objective, { includeNone: false })}</select></label>
      <label class="filter"><span class="sr-only">Priority</span><select class="input input--small" data-change="tasks-filter-select" data-name="priority" aria-label="Priority">${options([{ value: '', label: 'Any priority' }, { value: 'high', label: 'High' }, { value: 'med', label: 'Medium' }, { value: 'low', label: 'Low' }], q.priority || '')}</select></label>
      ${tags.length ? `<label class="filter"><span class="sr-only">Tag</span><select class="input input--small" data-change="tasks-filter-select" data-name="tag" aria-label="Tag">${options([{ value: '', label: 'Any tag' }, ...tags.map((t) => ({ value: t, label: `#${t}` }))], q.tag || '')}</select></label>` : ''}
      <label class="check-row check-row--inline"><input type="checkbox" data-change="tasks-filter-check" data-name="win" ${q.win === '1' ? 'checked' : ''}> Day Wins</label>
      <label class="filter filter--sort">Sort <select class="input input--small" data-change="tasks-filter-select" data-name="sort" aria-label="Sort">${options(SORT, q.sort || (status === 'completed' ? 'updated' : 'date'))}</select></label>
      ${filtered ? '<button type="button" class="link-btn" data-action="tasks-clear">Clear filters</button>' : ''}
    </div>
    ${status === 'open' && !filtered ? `<div class="card card--flat">${quickAddForm(null, { placeholder: 'Add to inbox… (use @today or @fri to plan it)' })}</div>` : ''}
    <p class="result-count" role="status">${list.length} task${list.length === 1 ? '' : 's'}</p>
    ${list.length ? `<ul class="task-list task-list--all">${list.slice(0, limit).map((t) => taskRow(t, { showDate: true, allowWin: false, listKey, date: t.plannedDate && t.status !== 'archived' ? t.plannedDate : null })).join('')}</ul>
      ${list.length > limit ? `<button type="button" class="btn btn--ghost btn--block" data-action="tasks-more" data-value="${limit + 150}">Show more (${list.length - limit} left)</button>` : ''}`
    : emptyState({ icon: status === 'recurring' ? 'repeat' : 'list', title: filtered ? 'No tasks match these filters' : status === 'recurring' ? 'No repeating tasks' : 'Nothing here', text: status === 'recurring' ? 'Create a task and set it to repeat — each day gets its own copy.' : '' })}
  </div>`;
}

let searchTimer = null;
registerActions({
  'tasks-filter': (el) => setQuery({ [el.dataset.name]: el.dataset.value, limit: null }),
  'tasks-filter-select': (el) => setQuery({ [el.dataset.name]: el.value || null, limit: null }),
  'tasks-filter-check': (el) => setQuery({ [el.dataset.name]: el.checked ? '1' : null }),
  'tasks-search': (el) => setQuery({ q: el.value.trim() || null }),
  'tasks-search-live': (el) => { clearTimeout(searchTimer); searchTimer = setTimeout(() => setQuery({ q: el.value.trim() || null }), 250); },
  'tasks-clear': () => setQuery({ when: null, project: null, objective: null, priority: null, tag: null, q: null, win: null }),
  'tasks-more': (el) => setQuery({ limit: el.dataset.value }),
});

export { describeRecurrence, get, state };
