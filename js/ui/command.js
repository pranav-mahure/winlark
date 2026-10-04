/** Command palette (Ctrl/Cmd+K or /) and keyboard shortcuts (? for help). */
import { state, all } from '../core/state.js';
import { esc, qs, qsa, isTypingTarget } from '../utils/dom.js';
import { todayKey, addDays, parseNaturalDate, relativeLabel, formatLong } from '../utils/dates.js';
import { icon } from './icons.js';
import { openModal, modalOpen, closeTopModal } from './modals.js';
import { closeMenu, menuOpen } from './components.js';
import { navigate } from './router.js';
import { runAction } from './actions.js';
import { ROUTES, THEMES } from '../core/constants.js';
import { searchTasks } from '../features/tasks.js';
import { isFocusMode, closeFocusMode, toggleFocusMode } from './focus-mode.js';
import { timerView } from '../features/timer.js';

export const SHORTCUTS = [
  ['Timer', [['Space', 'Start or pause the timer'], ['S', 'Skip to the next phase'], ['Shift + R', 'Reset the timer'], ['F', 'Toggle focus mode'], ['Esc', 'Exit focus mode, close a dialog or menu']]],
  ['Anywhere', [['Ctrl/⌘ + K  or  /', 'Open the command palette'], ['N', 'New task'], ['?', 'Show this list']]],
  ['Go to (press G, then…)', ROUTES.map((r) => [`G then ${r.key.toUpperCase()}`, r.label])],
  ['Lists', [['Alt + ↑ / ↓', 'Move the focused task up or down'], ['Enter', 'Activate the focused button']]],
];

export function openShortcutHelp() {
  openModal({
    title: 'Keyboard shortcuts', size: 'md',
    body: `<div class="shortcut-groups">${SHORTCUTS.map(([g, list]) => `<section><h3 class="shortcut-group__title">${esc(g)}</h3><dl class="shortcuts">${list.map(([k, d]) => `<div><dt>${k.split('  or  ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' or ')}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></section>`).join('')}</div>
      <p class="muted">Shortcuts are ignored while you are typing in a field.</p>`,
  });
}

function baseCommands() {
  const v = timerView();
  const t = todayKey();
  return [
    { group: 'Actions', label: v.status === 'running' ? 'Pause timer' : 'Start timer', icon: v.status === 'running' ? 'pause' : 'play', hint: 'Space', run: () => runAction('timer-toggle') },
    { group: 'Actions', label: 'New task', icon: 'plus', hint: 'N', run: () => runAction('new-task') },
    { group: 'Actions', label: 'Focus mode', icon: 'expand', hint: 'F', run: () => toggleFocusMode() },
    { group: 'Actions', label: 'Plan tomorrow', icon: 'plan', run: () => navigate(`#/plan/${addDays(t, 1)}`) },
    { group: 'Actions', label: 'Review today', icon: 'review', run: () => navigate(`#/review/${t}`) },
    { group: 'Actions', label: 'Choose today’s Day Win', icon: 'starFill', run: () => runAction('daywin-pick', { dataset: { date: t } }) },
    { group: 'Actions', label: 'Export backup', icon: 'download', run: () => runAction('backup-export') },
    { group: 'Actions', label: 'Log a session manually', icon: 'clock', run: () => runAction('session-log') },
    { group: 'Actions', label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', run: () => openShortcutHelp() },
    ...ROUTES.map((r) => ({ group: 'Go to', label: r.label, icon: r.icon, run: () => navigate(`#/${r.id}`) })),
    ...THEMES.map((th) => ({ group: 'Theme', label: `Theme: ${th.name}`, icon: 'palette', run: () => runAction('theme-set', { dataset: { value: th.id } }) })),
  ];
}

function results(q) {
  const s = q.trim().toLowerCase();
  const base = baseCommands();
  if (!s) return base.filter((c) => c.group !== 'Theme').slice(0, 14);
  const out = base.filter((c) => c.label.toLowerCase().includes(s));
  for (const t of searchTasks(s, 8)) out.push({ group: 'Tasks', label: t.title, icon: t.status === 'completed' ? 'check' : 'list', meta: t.plannedDate ? relativeLabel(t.plannedDate) : t.kind === 'series' ? 'Repeats' : 'Inbox', run: () => runAction('task-open', { dataset: { id: t.id } }) });
  for (const o of all('objectives').filter((x) => x.title.toLowerCase().includes(s)).slice(0, 4)) out.push({ group: 'Objectives', label: o.title, icon: 'target', run: () => navigate(`#/objectives/${o.id}`) });
  for (const p of all('projects').filter((x) => x.name.toLowerCase().includes(s)).slice(0, 4)) out.push({ group: 'Projects', label: p.name, icon: 'folder', run: () => navigate(`#/projects/${p.id}`) });
  for (const h of all('habits').filter((x) => x.name.toLowerCase().includes(s)).slice(0, 3)) out.push({ group: 'Habits', label: h.name, icon: 'leaf', run: () => navigate('#/habits') });
  const d = parseNaturalDate(s);
  if (d) {
    out.unshift({ group: 'Dates', label: `Plan ${formatLong(d)}`, icon: 'plan', run: () => navigate(`#/plan/${d}`) });
    if (d <= todayKey()) out.splice(1, 0, { group: 'Dates', label: `Review ${formatLong(d)}`, icon: 'review', run: () => navigate(`#/review/${d}`) });
  }
  out.push({ group: 'Create', label: `Add task “${q.trim()}” to today`, icon: 'plus', run: () => runAction('palette-create', null, null, q.trim()) });
  return out.slice(0, 30);
}

export function openPalette() {
  if (qs('.modal--palette')) return;
  let items = [];
  let sel = 0;
  const draw = (el) => {
    const list = qs('[data-palette-list]', el);
    let group = '';
    list.innerHTML = items.length ? items.map((c, i) => {
      const head = c.group !== group ? `<li class="palette__group" role="presentation">${esc((group = c.group))}</li>` : '';
      return `${head}<li role="option" id="pal-${i}" class="palette__item${i === sel ? ' is-selected' : ''}" aria-selected="${i === sel}" data-index="${i}">${icon(c.icon || 'chevRight', { size: 16 })}<span class="palette__label">${esc(c.label)}</span>${c.meta ? `<span class="palette__meta">${esc(c.meta)}</span>` : ''}${c.hint ? `<kbd>${esc(c.hint)}</kbd>` : ''}</li>`;
    }).join('') : '<li class="palette__empty">No results</li>';
    qs('[data-palette-input]', el).setAttribute('aria-activedescendant', items.length ? `pal-${sel}` : '');
    qs(`#pal-${sel}`, el)?.scrollIntoView({ block: 'nearest' });
  };
  const m = openModal({
    title: 'Command palette', size: 'md', className: 'modal--palette',
    body: `<div class="palette"><div class="palette__search">${icon('search')}<input type="text" class="palette__input" data-palette-input placeholder="Search tasks, pages, actions, or type a date…" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-autocomplete="list" autofocus autocomplete="off" spellcheck="false"></div>
      <ul class="palette__list" id="palette-list" role="listbox" data-palette-list></ul>
      <p class="palette__foot"><kbd>↑</kbd><kbd>↓</kbd> to move <kbd>Enter</kbd> to choose <kbd>Esc</kbd> to close</p></div>`,
    onMount(el, close) {
      const input = qs('[data-palette-input]', el);
      const update = () => { items = results(input.value); sel = 0; draw(el); };
      const choose = (i) => { const c = items[i]; if (!c) return; close(); setTimeout(() => c.run(), 0); };
      input.addEventListener('input', update);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(items.length - 1, sel + 1); draw(el); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); draw(el); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
      });
      qs('[data-palette-list]', el).addEventListener('click', (e) => { const li = e.target.closest('[data-index]'); if (li) choose(Number(li.dataset.index)); });
      update();
    },
  });
  return m;
}

let gPending = 0;

export function installShortcuts() {
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (!qs('.modal--palette')) openPalette(); else closeTopModal();
      return;
    }
    if (e.defaultPrevented || e.isComposing) return;
    if (e.key === 'Escape') {
      if (menuOpen()) { closeMenu(true); return; }
      if (!modalOpen() && isFocusMode()) { e.preventDefault(); closeFocusMode(); }
      return;
    }
    if (modalOpen() || isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (gPending && Date.now() - gPending < 1500) {
      gPending = 0;
      const r = ROUTES.find((x) => x.key === k.toLowerCase());
      if (r) { e.preventDefault(); navigate(`#/${r.id}`); }
      return;
    }
    if (k === ' ' || k === 'Spacebar') {
      const t = e.target;
      if (t && t !== document.body && (t.tagName === 'BUTTON' || t.tagName === 'A' || t.getAttribute?.('role') === 'button' || t.tagName === 'SUMMARY')) return;
      e.preventDefault();
      runAction('timer-toggle');
    } else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFocusMode(); }
    else if (k === 'n' || k === 'N') { e.preventDefault(); runAction('new-task'); }
    else if (k === '/') { e.preventDefault(); openPalette(); }
    else if (k === '?') { e.preventDefault(); openShortcutHelp(); }
    else if (k === 's' || k === 'S') { e.preventDefault(); runAction('timer-skip'); }
    else if (k === 'R' && e.shiftKey) { e.preventDefault(); runAction('timer-reset'); }
    else if (k === 'g' || k === 'G') { gPending = Date.now(); }
  });
}
