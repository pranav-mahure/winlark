/** Global actions shared by every view (tasks, Day Win, timer, navigation). */
import { state, get } from '../core/state.js';
import { registerActions, runAction } from './actions.js';
import { registerSortable } from './dnd.js';
import { navigate } from './router.js';
import { toast, undoToast, errorToast } from './toast.js';
import { confirmDialog, choiceDialog } from './modals.js';
import { openMenu } from './components.js';
import { openTaskForm, openTaskDetail, openMoveDialog, pickTask } from './task-dialogs.js';
import { todayKey, addDays, relativeLabel, formatKey } from '../utils/dates.js';
import { ValidationError } from '../utils/validation.js';
import {
  completeTask, reopenTask, deleteTask, duplicateTask, archiveTask, unarchiveTask, moveTask, setOrder, nudgeTask,
  parseQuickAdd, createTask, tasksOn, isOpen, openTasks, skipOccurrence, stopRepeating, taskActual, overdueOpen,
} from '../features/tasks.js';
import { setDayWin, clearDayWin, getPlan } from '../features/daily-plan.js';
import * as timer from '../features/timer.js';
import { unlockAudio } from '../features/audio.js';
import { listProjects } from '../features/projects.js';

/** Ordered id lists registered by views during render (for Move up/down). */
export const lists = new Map();

export function registerList(key, ids) { lists.set(key, ids); return key; }

async function toggleWin(id, date) {
  if (getPlan(date).dayWinTaskId === id) {
    await clearDayWin(date);
    toast(`No Day Win for ${relativeLabel(date)} now.`, { tone: 'info' });
    return;
  }
  const { previous } = await setDayWin(date, id);
  toast(previous ? `Day Win changed from “${previous.title}”.` : `Day Win set for ${relativeLabel(date)}.`, { tone: 'win' });
}

async function completeWithFeedback(id) {
  const t = get('tasks', id);
  if (!t) return;
  if (t.status === 'completed') {
    await reopenTask(id);
    toast('Task reopened.', { tone: 'info' });
    return;
  }
  const wasWin = t.plannedDate && getPlan(t.plannedDate).dayWinTaskId === id;
  await completeTask(id);
  if (timer.activeTaskId() === id && timer.timerView().status === 'idle') timer.setTask(null);
  toast(wasWin ? `Day Win completed: “${t.title}”.` : `Completed “${t.title}”.`, {
    tone: wasWin ? 'win' : 'success',
    action: { label: 'Undo', run: () => reopenTask(id) },
  });
}

export async function deleteTaskFlow(id) {
  const t = get('tasks', id);
  if (!t) return;
  if (t.kind === 'series') {
    const ok = await confirmDialog({
      title: 'Delete repeating task?', danger: true, confirmLabel: 'Delete series',
      message: `“${t.title}” will stop repeating. Upcoming days without progress are removed; past days and their focus history are kept as ordinary tasks.`,
    });
    if (!ok) return;
    const inv = await deleteTask(id);
    undoToast('Repeating task deleted.', inv);
    return;
  }
  const sessions = taskActual(id).sessions.length;
  let deleteSessions = false;
  if (sessions) {
    const choice = await choiceDialog({
      title: 'Delete task?',
      message: `“${t.title}” has ${sessions} focus session${sessions === 1 ? '' : 's'}. Keep them in your history as unassigned focus time, or delete them too?`,
      choices: [{ id: 'all', label: 'Delete sessions too', danger: true }, { id: 'keep', label: 'Keep sessions', primary: true }],
    });
    if (!choice) return;
    deleteSessions = choice === 'all';
  }
  if (t.kind === 'occurrence' && t.seriesId && t.plannedDate >= todayKey()) await skipOccurrence(t.seriesId, t.plannedDate);
  const inv = await deleteTask(id, { deleteSessions });
  if (timer.activeTaskId() === id) timer.setTask(null);
  undoToast(`Deleted “${t.title}”.`, inv);
}

async function quickAdd(form, _e, fd) {
  const input = form.querySelector('[name="q"]');
  const raw = String(fd.get('q') || '');
  const date = form.dataset.date === undefined ? todayKey() : (form.dataset.date || null);
  const parsed = parseQuickAdd(raw, { projects: listProjects() });
  if (!parsed.title) throw new ValidationError('Type a task title first.');
  const plannedDate = parsed.plannedDate !== undefined ? parsed.plannedDate : date;
  const t = await createTask({
    title: parsed.title, estimate: parsed.estimate, priority: parsed.priority || 'med', tags: parsed.tags,
    plannedDate, projectId: parsed.projectId || form.dataset.projectId || null, objectiveId: form.dataset.objectiveId || null,
  });
  if (parsed.dayWin && plannedDate) await toggleWin(t.id, plannedDate);
  input.value = '';
  input.focus();
  const where = plannedDate ? relativeLabel(plannedDate) : 'the inbox';
  if (!parsed.dayWin) toast(`Added to ${where}.`, { tone: 'success', duration: 2500, action: { label: 'Edit', run: () => openTaskForm({ task: get('tasks', t.id) }) } });
}

function taskMenuItems(t, date, listKey) {
  const today = todayKey();
  const open = isOpen(t);
  const ids = listKey ? lists.get(listKey) : null;
  const idx = ids ? ids.indexOf(t.id) : -1;
  const isWin = date && getPlan(date).dayWinTaskId === t.id;
  return [
    { label: 'Open details', icon: 'info', action: 'task-open', data: { id: t.id } },
    { label: 'Edit', icon: 'edit', action: 'task-edit', data: { id: t.id } },
    open && t.kind !== 'series' ? { label: 'Move to another day…', icon: 'move', action: 'task-move', data: { id: t.id } } : null,
    open && t.kind !== 'series' && t.plannedDate !== today ? { label: 'Plan for today', icon: 'sun', action: 'task-plan', data: { id: t.id, to: today } } : null,
    open && t.kind !== 'series' && t.plannedDate !== addDays(today, 1) ? { label: 'Plan for tomorrow', icon: 'plan', action: 'task-plan', data: { id: t.id, to: addDays(today, 1) } } : null,
    open && date && t.plannedDate === date ? { label: isWin ? 'Remove as Day Win' : 'Make Day Win', icon: isWin ? 'star' : 'starFill', action: 'daywin-toggle', data: { id: t.id, date } } : null,
    idx > 0 ? { label: 'Move up', icon: 'up', action: 'task-nudge', data: { id: t.id, list: listKey, dir: '-1' }, hint: 'Alt+↑' } : null,
    ids && idx >= 0 && idx < ids.length - 1 ? { label: 'Move down', icon: 'down', action: 'task-nudge', data: { id: t.id, list: listKey, dir: '1' }, hint: 'Alt+↓' } : null,
    { divider: true },
    t.kind !== 'series' ? { label: 'Duplicate', icon: 'copy', action: 'task-duplicate', data: { id: t.id } } : null,
    t.kind === 'occurrence' ? { label: 'Edit repeating series', icon: 'repeat', action: 'task-edit', data: { id: t.seriesId } } : null,
    t.kind === 'series' && t.status === 'active' ? { label: 'Stop repeating', icon: 'repeat', action: 'series-stop', data: { id: t.id } } : null,
    t.status === 'archived' ? { label: 'Unarchive', icon: 'archive', action: 'task-unarchive', data: { id: t.id } }
      : { label: 'Archive', icon: 'archive', action: 'task-archive', data: { id: t.id } },
    { label: 'Delete', icon: 'trash', action: 'task-delete', data: { id: t.id }, danger: true },
  ];
}

export function installGlobalHandlers() {
  registerSortable('tasks', (ids) => setOrder(ids));
  registerActions({
    nav: (el) => navigate(el.dataset.to || el.getAttribute('href')),
    'new-task': (el) => openTaskForm({ defaults: { plannedDate: el?.dataset.date === undefined ? todayKey() : (el.dataset.date || null), projectId: el?.dataset.projectId || null, objectiveId: el?.dataset.objectiveId || null } }),
    'quick-add': quickAdd,
    'task-open': (el) => openTaskDetail(el.dataset.id),
    'task-edit': (el) => { const t = get('tasks', el.dataset.id); if (t) openTaskForm({ task: t }); },
    'task-toggle': (el) => completeWithFeedback(el.dataset.id),
    'task-move': (el) => openMoveDialog(el.dataset.id),
    'task-plan': async (el) => { await moveTask(el.dataset.id, el.dataset.to); toast(`Planned for ${relativeLabel(el.dataset.to)}.`, { tone: 'success' }); },
    'task-delete': (el) => deleteTaskFlow(el.dataset.id),
    'task-duplicate': async (el) => { const t = await duplicateTask(el.dataset.id); if (t) toast('Duplicated.', { tone: 'success', action: { label: 'Edit', run: () => openTaskForm({ task: get('tasks', t.id) }) } }); },
    'task-archive': async (el) => { const inv = await archiveTask(el.dataset.id); undoToast('Archived. Its history stays in analytics.', inv); },
    'task-unarchive': async (el) => { await unarchiveTask(el.dataset.id); toast('Unarchived.', { tone: 'success' }); },
    'series-stop': async (el) => {
      if (await confirmDialog({ title: 'Stop repeating?', message: 'No new days will be created. Days already done stay in your history.', confirmLabel: 'Stop repeating' })) {
        await stopRepeating(el.dataset.id); toast('This task no longer repeats.', { tone: 'success' });
      }
    },
    'task-nudge': async (el) => { const ids = lists.get(el.dataset.list) || []; await nudgeTask(el.dataset.id, ids, Number(el.dataset.dir)); },
    'task-menu': (el) => {
      const t = get('tasks', el.dataset.id);
      if (t) openMenu(el, taskMenuItems(t, el.dataset.date || t.plannedDate, el.dataset.list), { label: `Actions for ${t.title}` });
    },
    'task-menu-more': (el) => {
      const t = get('tasks', el.dataset.id);
      if (!t) return;
      const anchor = document.querySelector(`[data-action="task-menu"][data-id="${CSS.escape(t.id)}"]`) || document.querySelector('#view');
      openMenu(anchor, taskMenuItems(t, el.dataset.date || t.plannedDate, null));
    },
    'daywin-toggle': (el) => toggleWin(el.dataset.id, el.dataset.date),
    'daywin-pick': async (el) => {
      const date = el.dataset.date || todayKey();
      const candidates = tasksOn(date).filter(isOpen);
      if (!candidates.length) {
        toast(`Add a task for ${relativeLabel(date)} first — the Day Win is one of that day’s tasks.`, { tone: 'info' });
        return;
      }
      const id = await pickTask({ title: `Day Win for ${relativeLabel(date)}`, tasks: candidates, hint: 'Pick the one task that would make the day a win if nothing else got done.' });
      if (id) await toggleWin(id, date);
    },
    'daywin-clear': async (el) => { await clearDayWin(el.dataset.date); toast('Day Win cleared.', { tone: 'info' }); },
    'daywin-top': async (el) => {
      const date = el.dataset.date;
      const win = getPlan(date).dayWinTaskId;
      const ids = tasksOn(date).map((t) => t.id);
      await setOrder([win, ...ids.filter((x) => x !== win)]);
      toast('Day Win moved to the top.', { tone: 'success' });
    },
    'insight-move': async (el) => {
      const t = get('tasks', el.dataset.taskId || el.dataset.id);
      if (!t) return;
      const to = el.dataset.to;
      if (await confirmDialog({ title: 'Move this task?', message: `Move “${t.title}” to ${formatKey(to)}? It will show as moved on ${formatKey(t.plannedDate)}.`, confirmLabel: 'Move task' })) {
        await moveTask(t.id, to);
        toast(`Moved to ${relativeLabel(to)}.`, { tone: 'success', action: { label: 'Undo', run: () => moveTask(t.id, t.plannedDate) } });
      }
    },
    'overdue-move-today': async () => {
      const list = overdueOpen(todayKey());
      if (!list.length) return;
      if (!await confirmDialog({ title: `Move ${list.length} task${list.length === 1 ? '' : 's'} to today?`, message: 'Each one keeps a record that it was moved from its original day.', confirmLabel: 'Move to today' })) return;
      for (const t of list) await moveTask(t.id, todayKey());
      toast(`Moved ${list.length} to today.`, { tone: 'success' });
    },

    // ----- timer -----
    'timer-toggle': () => { unlockAudio(); timer.toggle(); },
    'timer-skip': () => timer.skip(),
    'timer-reset': () => {
      if (!timer.hasProgress()) { timer.reset(); return; }
      const before = timer.reset();
      toast('Timer reset. The partial session was not saved.', { tone: 'info', action: { label: 'Undo', run: () => timer.undoReset(before) } });
    },
    'timer-mode': async (el) => {
      if (timer.hasProgress() && !await confirmDialog({ title: 'Switch mode?', message: 'The current session will be discarded.', confirmLabel: 'Switch' })) return;
      timer.setMode(el.dataset.mode);
    },
    'task-focus': (el) => {
      const t = get('tasks', el.dataset.id);
      if (!t) return;
      timer.setTask(t.id);
      if (timer.timerView().mode !== 'focus' && timer.timerView().status === 'idle') timer.setMode('focus');
      if (el.dataset.start !== undefined && timer.timerView().status !== 'running') { unlockAudio(); timer.start(); }
      else toast(`Next Pomodoro counts toward “${t.title}”.`, { tone: 'success', duration: 2500 });
    },
    'task-focus-clear': () => timer.setTask(null),
    'pick-active-task': async () => {
      const today = todayKey();
      const todays = tasksOn(today).filter(isOpen);
      const rest = openTasks().filter((t) => t.plannedDate !== today);
      const id = await pickTask({ title: 'What are you focusing on?', tasks: [...todays, ...rest], hint: 'Today’s tasks are listed first.' });
      if (id) timer.setTask(id);
    },
    retry: () => location.reload(),
  });
}

export { runAction, errorToast };
