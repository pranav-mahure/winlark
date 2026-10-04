/** History — every recorded session, completion and check-in; editable. */
import { state, get, all } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { todayKey, addDays, formatLong, formatKey, isValidKey, toLocalInputValue, fromLocalInputValue, keyFromTs } from '../utils/dates.js';
import { fmtDuration, fmtTime, plural } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, projectOptions, objectiveOptions, options, projectChip } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { setQuery } from '../ui/router.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, undoToast } from '../ui/toast.js';
import { pickTask } from '../ui/task-dialogs.js';
import { sessionLabel, updateSession, deleteSessions, assignSession, logManualSession } from '../features/sessions.js';
import { completionIndex } from '../features/analytics.js';
import { setHabitDone } from '../features/habits.js';
import { openTasks } from '../features/tasks.js';

export const title = 'History';
const PAGE = 60;

function collect(q) {
  const from = isValidKey(q.from) ? q.from : null;
  const to = isValidKey(q.to) ? q.to : null;
  const type = q.type || 'all';
  const text = (q.task || '').toLowerCase();
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const items = [];
  if (['all', 'focus', 'stopped', 'breaks', 'unassigned'].includes(type)) {
    for (const s of state.sessions.values()) {
      if (!inRange(s.date)) continue;
      if (type === 'focus' && !(s.type === 'focus' && s.completed)) continue;
      if (type === 'stopped' && !(s.type === 'focus' && !s.completed)) continue;
      if (type === 'breaks' && s.type === 'focus') continue;
      if (type === 'unassigned' && !(s.type === 'focus' && !s.taskId)) continue;
      if (q.project && (q.project === '_none' ? s.projectId : s.projectId !== q.project)) continue;
      if (q.objective && s.objectiveId !== q.objective) continue;
      if (q.source && s.source !== q.source) continue;
      const task = s.taskId ? get('tasks', s.taskId) : null;
      if (text && !(task?.title.toLowerCase().includes(text) || s.notes?.toLowerCase().includes(text) || s.legacyRef?.deletedTaskTitle?.toLowerCase().includes(text))) continue;
      items.push({ kind: 'session', date: s.date, t: s.startTime ?? s.endTime ?? 0, dur: s.actualDuration || 0, s, task });
    }
  }
  if (['all', 'completions'].includes(type) && !q.source && !q.objective) {
    for (const [date, list] of completionIndex()) {
      if (!inRange(date)) continue;
      for (const c of list) {
        if (q.project && (q.project === '_none' ? c.projectId : c.projectId !== q.project)) continue;
        if (text && !c.title.toLowerCase().includes(text)) continue;
        const task = c.taskId ? get('tasks', c.taskId) : null;
        items.push({ kind: 'completion', date, t: task?.completedAt || 0, dur: 0, c, task });
      }
    }
  }
  if (['all', 'habits'].includes(type) && !q.project && !q.source && !q.objective) {
    for (const hc of state.habitCompletions.values()) {
      if (!inRange(hc.date)) continue;
      if (q.habit && hc.habitId !== q.habit) continue;
      const h = get('habits', hc.habitId);
      if (text && !h?.name.toLowerCase().includes(text)) continue;
      items.push({ kind: 'habit', date: hc.date, t: hc.completedAt || 0, dur: 0, hc, habit: h });
    }
  }
  const sort = q.sort || 'new';
  items.sort(sort === 'old' ? (a, b) => a.date.localeCompare(b.date) || a.t - b.t
    : sort === 'long' ? (a, b) => b.dur - a.dur
      : (a, b) => b.date.localeCompare(a.date) || b.t - a.t);
  return items;
}

function itemHtml(it) {
  if (it.kind === 'session') {
    const s = it.s;
    const name = it.task ? it.task.title : s.type === 'focus' ? (s.legacyRef?.deletedTaskTitle ? `Deleted task: ${s.legacyRef.deletedTaskTitle}` : 'Unassigned') : '';
    return `<li class="hist-item hist-item--${s.type}${s.completed ? '' : ' is-stopped'}">
      <span class="hist-item__time">${s.startTime ? esc(fmtTime(s.startTime)) : '<span class="muted" title="Imported from PomoFocus 1.x without a time">—</span>'}</span>
      <span class="hist-item__kind"><span class="kind-dot kind-dot--${s.type}"></span>${esc(sessionLabel(s))}</span>
      <span class="hist-item__what">${it.task ? `<button type="button" class="link-btn" data-action="task-open" data-id="${esc(it.task.id)}">${esc(name)}</button>` : `<span class="${s.type === 'focus' ? 'muted' : ''}">${esc(name)}</span>`} ${projectChip(s.projectId)}${s.source !== 'timer' ? `<span class="source-tag">${s.source === 'legacy' ? 'imported' : 'manual'}</span>` : ''}${s.notes ? `<span class="muted small" title="${esc(s.notes)}">${icon('edit', { size: 11 })}</span>` : ''}</span>
      <span class="hist-item__dur">${fmtDuration((s.actualDuration || 0) / 60)}</span>
      <span class="hist-item__actions">
        ${s.type === 'focus' && !s.taskId ? `<button type="button" class="btn btn--small btn--secondary" data-action="session-assign" data-id="${esc(s.id)}">Assign</button>` : ''}
        <button type="button" class="icon-btn" data-action="session-edit" data-id="${esc(s.id)}" aria-label="Edit session">${icon('edit', { size: 15 })}</button>
        <button type="button" class="icon-btn" data-action="session-delete" data-id="${esc(s.id)}" aria-label="Delete session">${icon('trash', { size: 15 })}</button></span>
    </li>`;
  }
  if (it.kind === 'completion') {
    return `<li class="hist-item hist-item--completion"><span class="hist-item__time">${it.task?.completedAt && it.task.completedDate === it.date ? esc(fmtTime(it.task.completedAt)) : '—'}</span>
      <span class="hist-item__kind"><span class="kind-dot kind-dot--done"></span>Task completed</span>
      <span class="hist-item__what">${it.task ? `<button type="button" class="link-btn" data-action="task-open" data-id="${esc(it.task.id)}">${esc(it.c.title)}</button>` : esc(it.c.title)} ${projectChip(it.c.projectId)}${it.c.source === 'history' ? '<span class="source-tag">imported</span>' : ''}</span><span></span><span></span></li>`;
  }
  return `<li class="hist-item hist-item--habit"><span class="hist-item__time">${it.hc.completedAt && keyFromTs(it.hc.completedAt) === it.date ? esc(fmtTime(it.hc.completedAt)) : '—'}</span>
    <span class="hist-item__kind"><span class="kind-dot kind-dot--habit"></span>Habit</span><span class="hist-item__what">${esc(it.habit?.name || 'Deleted habit')}</span><span></span>
    <span class="hist-item__actions"><button type="button" class="icon-btn" data-action="habit-uncheck" data-id="${esc(it.hc.habitId)}" data-date="${it.date}" aria-label="Remove check-in">${icon('trash', { size: 15 })}</button></span></li>`;
}

export function render(route) {
  const q = route.query;
  const items = collect(q);
  const page = Math.max(1, Number(q.page) || 1);
  const shown = items.slice(0, page * PAGE);
  const groups = new Map();
  for (const it of shown) { if (!groups.has(it.date)) groups.set(it.date, []); groups.get(it.date).push(it); }
  const focusTotal = items.filter((i) => i.kind === 'session' && i.s.type === 'focus' && i.s.completed);
  const totalMin = focusTotal.reduce((s, i) => s + i.dur / 60, 0);
  const filtered = ['from', 'to', 'type', 'project', 'task', 'objective', 'source', 'habit'].some((k) => q[k]);
  const habits = all('habits');
  return `<div class="page page--history">
    <header class="page-head"><div><h1 class="page-title">History</h1><p class="page-head__sub">${plural(focusTotal.length, 'Pomodoro')}, ${fmtDuration(totalMin)} of focus${filtered ? ' match these filters' : ' recorded'}</p></div>
      <div class="page-head__actions"><button type="button" class="btn btn--secondary" data-action="session-log">${icon('plus', { size: 15 })}Log a session</button></div></header>
    <div class="filter-bar card">
      <label class="filter">From <input type="date" class="input input--small" value="${esc(q.from || '')}" data-change="hist-filter" data-name="from"></label>
      <label class="filter">To <input type="date" class="input input--small" value="${esc(q.to || '')}" data-change="hist-filter" data-name="to"></label>
      <label class="filter"><span class="sr-only">Type</span><select class="input input--small" data-change="hist-filter" data-name="type" aria-label="Type">${options([{ value: '', label: 'Everything' }, { value: 'focus', label: 'Pomodoros' }, { value: 'stopped', label: 'Stopped early' }, { value: 'unassigned', label: 'Unassigned focus' }, { value: 'breaks', label: 'Breaks' }, { value: 'completions', label: 'Task completions' }, { value: 'habits', label: 'Habit check-ins' }], q.type || '')}</select></label>
      <label class="filter"><span class="sr-only">Project</span><select class="input input--small" data-change="hist-filter" data-name="project" aria-label="Project"><option value="">All projects</option><option value="_none" ${q.project === '_none' ? 'selected' : ''}>No project</option>${projectOptions(q.project, { includeNone: false, includeArchived: true })}</select></label>
      <label class="filter"><span class="sr-only">Objective</span><select class="input input--small" data-change="hist-filter" data-name="objective" aria-label="Objective"><option value="">All objectives</option>${objectiveOptions(q.objective, { includeNone: false })}</select></label>
      ${habits.length ? `<label class="filter"><span class="sr-only">Habit</span><select class="input input--small" data-change="hist-filter" data-name="habit" aria-label="Habit">${options([{ value: '', label: 'All habits' }, ...habits.map((h) => ({ value: h.id, label: h.name }))], q.habit || '')}</select></label>` : ''}
      <label class="filter"><span class="sr-only">Source</span><select class="input input--small" data-change="hist-filter" data-name="source" aria-label="Source">${options([{ value: '', label: 'Any source' }, { value: 'timer', label: 'Timer' }, { value: 'manual', label: 'Logged manually' }, { value: 'legacy', label: 'Imported (v1)' }], q.source || '')}</select></label>
      <div class="search-field">${icon('search', { size: 16 })}<input type="search" class="input input--small" placeholder="Task, habit or note…" value="${esc(q.task || '')}" data-change="hist-filter" data-name="task" aria-label="Search history"></div>
      <label class="filter filter--sort">Sort <select class="input input--small" data-change="hist-filter" data-name="sort">${options([{ value: 'new', label: 'Newest' }, { value: 'old', label: 'Oldest' }, { value: 'long', label: 'Longest' }], q.sort || 'new')}</select></label>
      ${filtered ? '<button type="button" class="link-btn" data-action="hist-clear">Clear</button>' : ''}
    </div>
    ${items.length ? `<div class="history-days">${[...groups.entries()].map(([date, list]) => {
    const dayMin = list.filter((i) => i.kind === 'session' && i.s.type === 'focus' && i.s.completed).reduce((s, i) => s + i.dur / 60, 0);
    return `<section class="hist-day"><h2 class="hist-day__head"><a href="#/calendar/${date.slice(0, 7)}?d=${date}">${esc(formatLong(date))}${date.slice(0, 4) !== todayKey().slice(0, 4) ? ` ${date.slice(0, 4)}` : ''}</a><span class="muted">${dayMin ? fmtDuration(dayMin) : ''}</span></h2><ul class="hist-list">${list.map(itemHtml).join('')}</ul></section>`;
  }).join('')}</div>
    ${items.length > shown.length ? `<button type="button" class="btn btn--ghost btn--block" data-action="hist-more" data-value="${page + 1}">Show more (${items.length - shown.length} left)</button>` : ''}`
    : emptyState({ icon: 'clock', title: filtered ? 'Nothing matches these filters' : 'No history yet', text: filtered ? '' : 'Finished Pomodoros, completed tasks and habit check-ins appear here.' })}
  </div>`;
}

function taskSelect(selected) {
  const open = openTasks();
  const since = addDays(todayKey(), -30);
  const done = all('tasks').filter((t) => t.kind !== 'series' && t.status === 'completed' && (t.completedDate || '') >= since)
    .sort((a, b) => (b.completedDate || '').localeCompare(a.completedDate || ''));
  const cur = selected ? get('tasks', selected) : null;
  const opt = (t) => `<option value="${esc(t.id)}" ${t.id === selected ? 'selected' : ''}>${esc(t.title)}</option>`;
  const extra = cur && !open.includes(cur) && !done.includes(cur) ? `<optgroup label="Current">${opt(cur)}</optgroup>` : '';
  return `<option value="">Unassigned</option>${extra}<optgroup label="Open tasks">${open.slice(0, 300).map(opt).join('')}</optgroup>${done.length ? `<optgroup label="Completed in the last 30 days">${done.slice(0, 200).map(opt).join('')}</optgroup>` : ''}`;
}

export function openSessionForm(s = null) {
  const now = Date.now();
  const x = s || { type: 'focus', startTime: now - state.settings.timer.focusMin * 60000, actualDuration: state.settings.timer.focusMin * 60, completed: true, date: todayKey() };
  const m = openModal({
    title: s ? 'Edit session' : 'Log a session', size: 'sm',
    subtitle: s?.source === 'legacy' ? 'Imported from PomoFocus 1.x (no start time was recorded).' : '',
    body: `<form id="session-form" class="form" novalidate>
      <div class="form-grid">
        <div class="field"><label class="field__label" for="ss-type">Type</label><select id="ss-type" name="type" class="input">${options([{ value: 'focus', label: 'Focus' }, { value: 'shortBreak', label: 'Short break' }, { value: 'longBreak', label: 'Long break' }], x.type)}</select></div>
        <div class="field"><label class="field__label" for="ss-dur">Duration (minutes)</label><input id="ss-dur" type="number" name="duration" min="1" max="600" class="input" value="${Math.round((x.actualDuration || 0) / 60)}" required></div>
      </div>
      <div class="field"><label class="field__label" for="ss-start">Started</label><input id="ss-start" type="datetime-local" name="start" class="input" value="${x.startTime ? toLocalInputValue(x.startTime) : ''}">
        ${!x.startTime ? `<p class="field__hint">No start time. The session stays on ${esc(formatKey(x.date))} unless you set one.</p>` : ''}</div>
      ${!x.startTime ? `<div class="field"><label class="field__label" for="ss-date">Date</label><input id="ss-date" type="date" name="date" class="input" value="${esc(x.date)}"></div>` : ''}
      <div class="field"><label class="field__label" for="ss-task">Task</label><select id="ss-task" name="taskId" class="input">${taskSelect(x.taskId)}</select></div>
      <label class="check-row"><input type="checkbox" name="completed" ${x.completed ? 'checked' : ''}> Counts as a completed session</label>
      <div class="field"><label class="field__label" for="ss-notes">Notes</label><textarea id="ss-notes" name="notes" class="input" rows="2">${esc(x.notes || '')}</textarea></div>
      <p class="form-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="session-form" class="btn btn--primary">${s ? 'Save' : 'Log session'}</button>`,
    onMount(el, close) {
      qs('#session-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        try {
          const dur = Number(fd.get('duration'));
          if (!Number.isFinite(dur) || dur <= 0 || dur > 600) throw new Error('Duration must be between 1 and 600 minutes.');
          const start = fd.get('start') ? fromLocalInputValue(fd.get('start')) : null;
          if (fd.get('start') && !start) throw new Error('The start time is not valid.');
          if (start && start > Date.now()) throw new Error('A session can’t start in the future.');
          const date = start ? keyFromTs(start) : (fd.get('date') || x.date);
          if (!isValidKey(date)) throw new Error('Choose a valid date.');
          if (s) {
            await updateSession(s.id, { type: fd.get('type'), actualDuration: Math.round(dur * 60), startTime: start, endTime: start ? start + dur * 60000 : null, date, taskId: fd.get('taskId') || null, completed: fd.get('completed') === 'on', notes: fd.get('notes') || '' });
            toast('Session updated.', { tone: 'success' });
          } else {
            const rec = await logManualSession({ type: fd.get('type'), date, startTime: start, durationMin: dur, taskId: fd.get('taskId') || null, notes: fd.get('notes') || '' });
            if (fd.get('completed') !== 'on') await updateSession(rec.id, { completed: false });
            toast('Session logged.', { tone: 'success' });
          }
          close(true);
        } catch (err) { const b = qs('.form-error', el); b.textContent = err.message; b.hidden = false; }
      });
    },
  });
  return m.result;
}

registerActions({
  'hist-filter': (el) => setQuery({ [el.dataset.name]: el.value || null, page: null }),
  'hist-clear': () => setQuery({ from: null, to: null, type: null, project: null, task: null, objective: null, source: null, habit: null, page: null }),
  'hist-more': (el) => setQuery({ page: el.dataset.value }),
  'session-log': () => openSessionForm(),
  'session-edit': (el) => openSessionForm(get('sessions', el.dataset.id)),
  'session-delete': async (el) => {
    const s = get('sessions', el.dataset.id);
    if (!s) return;
    if (!await confirmDialog({ title: 'Delete this session?', danger: true, confirmLabel: 'Delete', message: `${sessionLabel(s)} on ${formatKey(s.date)}, ${fmtDuration((s.actualDuration || 0) / 60)}. Totals and analytics will update.` })) return;
    const inv = await deleteSessions([s.id]);
    undoToast('Session deleted.', inv);
  },
  'session-assign': async (el) => {
    const id = await pickTask({ title: 'Assign this session to a task', tasks: [...openTasks(), ...all('tasks').filter((t) => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0)).slice(0, 50)] });
    if (!id) return;
    await assignSession(el.dataset.id, id);
    toast(`Assigned to “${get('tasks', id).title}”.`, { tone: 'success' });
  },
  'habit-uncheck': async (el) => { await setHabitDone(el.dataset.id, el.dataset.date, false); toast('Check-in removed.', { tone: 'info', action: { label: 'Undo', run: () => setHabitDone(el.dataset.id, el.dataset.date, true) } }); },
});

export { addDays };
