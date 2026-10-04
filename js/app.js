/**
 * Winlark 2.0 — application entry point.
 *
 * Boot order:
 *   1. open storage (IndexedDB, or in-memory fallback with a warning)
 *   2. load every collection into memory (core/state.js)
 *   3. first-run defaults, today's repeating tasks, timer restore
 *   4. render the shell and the current route
 *   5. offer to import PomoFocus 1.x data if it is still in localStorage
 *   6. register the service worker (offline + update prompt)
 */
import { state, loadAll, getMeta, setMeta, all } from './core/state.js';
import { on, emit } from './core/events.js';
import { ROUTES, APP_NAME, DATA_COLLECTIONS } from './core/constants.js';
import { createRepository } from './storage/repository.js';
import { readLegacyLocalStorage } from './storage/migration.js';
import { todayKey } from './utils/dates.js';
import { esc, qs, debounce, prefersReducedMotion } from './utils/dom.js';
import { icon } from './ui/icons.js';
import { installActions, registerActions, runAction } from './ui/actions.js';
import { installModalKeys, openModal } from './ui/modals.js';
import { installShortcuts, openPalette, openShortcutHelp } from './ui/command.js';
import { installSortable } from './ui/dnd.js';
import { installTooltips } from './ui/charts.js';
import { installGlobalHandlers } from './ui/handlers.js';
import { initRouter, navigate } from './ui/router.js';
import { registerView, scheduleRender, renderNow, renderMiniTimer } from './ui/render.js';
import { updateTimerDom } from './ui/timer-ui.js';
import { toast } from './ui/toast.js';
import { openFocusMode, closeFocusMode, toggleFocusMode, isFocusMode, renderFocusMode } from './ui/focus-mode.js';
import { pickTask } from './ui/task-dialogs.js';
import * as timer from './features/timer.js';
import { ensureOccurrences, parseQuickAdd, createTask } from './features/tasks.js';
import { ensureDefaultStreaks } from './features/streaks.js';
import { assignSession } from './features/sessions.js';
import { focusOn } from './features/analytics.js';
import { unlockAudio, playAlarm, playTick, startAmbient, stopAmbient, ambientPlaying, setAmbientVolume } from './features/audio.js';
import { notify } from './features/notifications.js';
import { listProjects } from './features/projects.js';

import * as today from './views/today.js';
import * as plan from './views/plan.js';
import * as tasks from './views/tasks.js';
import * as objectives from './views/objectives.js';
import * as habits from './views/habits.js';
import * as calendar from './views/calendar.js';
import * as analytics from './views/analytics.js';
import * as projects from './views/projects.js';
import * as history from './views/history.js';
import * as settings from './views/settings.js';
import * as review from './views/review.js';
import { legacyImportFlow } from './views/settings.js';

const VIEWS = { today, plan, tasks, objectives, habits, calendar, analytics, projects, history, settings, review };
let currentDay = todayKey();
let audioUnlocked = false;
let ambientMuted = false;

// ---------- appearance ----------
function applyAppearance() {
  const a = state.settings.appearance;
  document.documentElement.dataset.theme = a.theme;
  try { localStorage.setItem('pomofocus:theme', a.theme); } catch { /* storage blocked */ }
  const reduce = a.motion === 'reduce' || (a.motion === 'system' && prefersReducedMotion());
  document.documentElement.classList.toggle('reduce-motion', reduce);
  const meta = qs('meta[name="theme-color"]');
  if (meta) {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) meta.setAttribute('content', bg);
  }
}

// ---------- ambient ----------
function syncAmbient() {
  const a = state.settings.ambient;
  const v = timer.timerView();
  const want = !ambientMuted && audioUnlocked && a.sound !== 'none'
    && (a.mode === 'always' || (v.mode === 'focus' && v.status === 'running'));
  if (want) { if (ambientPlaying() !== a.sound) startAmbient(a.sound, a.volume); else setAmbientVolume(a.volume); }
  else if (ambientPlaying()) stopAmbient();
}

// ---------- shell ----------
function renderShell() {
  const nav = ROUTES.map((r) => `<a class="nav-link" href="#/${r.id}" data-nav="${r.id}">${icon(r.icon, { size: 18 })}<span>${esc(r.label)}</span></a>`).join('');
  qs('#sidebar').innerHTML = `
    <a class="brand" href="#/today" aria-label="${APP_NAME} — Today">
      <svg class="brand__mark" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="6 2.2" opacity=".45"/><circle cx="16" cy="16" r="8" fill="none" stroke="var(--accent)" stroke-width="3.2" stroke-linecap="round" stroke-dasharray="38 60" transform="rotate(-90 16 16)"/></svg>
      <span class="brand__name">Winlark</span></a>
    <button type="button" class="search-btn" data-action="open-palette">${icon('search', { size: 16 })}<span>Search or jump…</span><kbd>Ctrl K</kbd></button>
    <nav class="nav" aria-label="Main">${nav}</nav>
    <div class="sidebar__foot">
      <button type="button" class="nav-link" data-action="new-task">${icon('plus', { size: 18 })}<span>New task</span><kbd>N</kbd></button>
      <button type="button" class="nav-link" data-action="open-shortcuts">${icon('keyboard', { size: 18 })}<span>Shortcuts</span><kbd>?</kbd></button>
    </div>`;
  const primary = ['today', 'plan', 'tasks', 'calendar'];
  qs('#bottom-nav').innerHTML = `${primary.map((id) => { const r = ROUTES.find((x) => x.id === id); return `<a class="bottom-link" href="#/${r.id}" data-nav="${r.id}">${icon(r.icon, { size: 20 })}<span>${esc(r.label)}</span></a>`; }).join('')}
    <button type="button" class="bottom-link" data-action="nav-more" data-nav-more aria-haspopup="dialog">${icon('menu', { size: 20 })}<span>More</span></button>`;
}

function openMoreSheet() {
  const items = ROUTES.filter((r) => !['today', 'plan', 'tasks', 'calendar'].includes(r.id));
  const m = openModal({
    title: 'More', size: 'sm', className: 'modal--sheet',
    body: `<nav class="more-grid" aria-label="More pages">${items.map((r) => `<a class="more-link" href="#/${r.id}" data-more-link>${icon(r.icon, { size: 22 })}<span>${esc(r.label)}</span></a>`).join('')}
      <button type="button" class="more-link" data-more-palette>${icon('search', { size: 22 })}<span>Search</span></button>
      <button type="button" class="more-link" data-more-new>${icon('plus', { size: 22 })}<span>New task</span></button></nav>`,
    onMount(el, close) {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-more-link]')) close();
        if (e.target.closest('[data-more-palette]')) { close(); setTimeout(openPalette, 50); }
        if (e.target.closest('[data-more-new]')) { close(); setTimeout(() => runAction('new-task'), 50); }
      });
    },
  });
  return m;
}

// ---------- timer events ----------
function onSessionCompleted({ session, mode, next, restored, auto, clearedTask }) {
  const s = state.settings;
  if (!restored) playAlarm(s.sound.alarm, s.sound.volume);
  const task = session?.taskId ? state.tasks.get(session.taskId) : null;
  if (mode === 'focus') {
    const goal = s.goals.dailyPomos;
    const n = focusOn(todayKey()).pomos;
    const title = restored ? 'A Pomodoro finished while Winlark was closed' : 'Pomodoro complete';
    const body = `${task ? `“${task.title}”` : 'Unassigned focus'}. ${next === 'longBreak' ? 'Time for a long break.' : 'Time for a short break.'}`;
    notify(title, body, { settings: s });
    toast(`${title}${task ? ` — “${task.title}”` : ' (unassigned)'}.${auto ? ' Break started.' : ''}`, {
      tone: 'success', duration: 7000,
      action: !task && session ? { label: 'Assign to a task', run: async () => { const id = await pickTask({ title: 'Assign this Pomodoro' }); if (id) await assignSession(session.id, id); } } : null,
    });
    if (goal && n === goal && !restored) toast(`Daily goal reached: ${goal} Pomodoros.`, { tone: 'win' });
    if (clearedTask) toast(`“${clearedTask.title}” is completed, so it is no longer the current focus.`, { tone: 'info' });
  } else {
    notify('Break over', 'Ready for the next Pomodoro?', { settings: s });
    toast(restored ? 'A break finished while Winlark was closed.' : `Break over.${auto ? ' Next Pomodoro started.' : ' Ready when you are.'}`, { tone: 'info' });
  }
}

// ---------- day rollover ----------
async function checkDay() {
  const t = todayKey();
  if (t === currentDay) return;
  const from = currentDay;
  currentDay = t;
  await ensureOccurrences(t);
  emit('day:changed', { from, to: t });
  scheduleRender();
}

// ---------- legacy data ----------
async function offerLegacyImport() {
  const legacy = readLegacyLocalStorage();
  if (!legacy.found || getMeta('legacyPrompted')) return;
  const hasData = DATA_COLLECTIONS.some((c) => state[c].size > (c === 'streaks' ? 2 : 0));
  const m = openModal({
    title: 'Bring over your PomoFocus 1.x data?', size: 'md',
    body: legacy.valid
      ? `<p>This browser still has data from the previous version of PomoFocus. It can be converted to 2.0 — your tasks, projects, Pomodoro history and settings.</p>
        <ul class="plain-list"><li>${icon('shield', { size: 14 })} A raw copy of the old data is saved first.</li><li>${icon('check', { size: 14 })} You’ll see a preview before anything is imported.</li><li>${icon('info', { size: 14 })} The old data is not deleted. You can remove it later in Settings → Data.</li></ul>
        ${hasData ? '<p class="muted small">You already have data in 2.0; choose Merge in the preview to keep it.</p>' : ''}`
      : `<p>Old PomoFocus data was found but could not be read: ${esc(legacy.error)}</p><p>You can download it from Settings → Data to keep a copy.</p>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-value="later">Not now</button>${legacy.valid ? '<button type="button" class="btn btn--primary" data-modal-value="import" autofocus>Review and import</button>' : '<button type="button" class="btn btn--primary" data-modal-value="later">OK</button>'}`,
  });
  const choice = await m.result;
  await setMeta('legacyPrompted', Date.now(), { silent: true });
  if (choice === 'import') await legacyImportFlow();
  else if (legacy.valid) toast('You can import the old data any time from Settings → Data.', { tone: 'info' });
}

// ---------- service worker ----------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  navigator.serviceWorker.register('./service-worker.js').then((reg) => {
    const prompt = (worker) => toast('A new version of Winlark is ready.', {
      tone: 'info', duration: 30000,
      action: { label: 'Update now', run: () => { reloading = true; worker.postMessage({ type: 'SKIP_WAITING' }); } },
    });
    if (reg.waiting && navigator.serviceWorker.controller) prompt(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) prompt(w); });
    });
  }).catch((err) => console.warn('[sw] registration failed', err));
}

// ---------- cross-tab sync ----------
function setupTabSync() {
  if (!('BroadcastChannel' in window)) return;
  const bc = new BroadcastChannel('pomofocus');
  let selfWrite = false;
  const announce = debounce(() => { bc.postMessage({ type: 'changed', at: Date.now() }); }, 150);
  on('data:changed', () => { if (!selfWrite) announce(); });
  on('timer:persisted', () => { if (!selfWrite) announce(); });
  const reload = debounce(async () => {
    selfWrite = true;
    try {
      await loadAll(state.repo);
      await timer.initTimer();
      applyAppearance();
      scheduleRender();
    } finally { setTimeout(() => { selfWrite = false; }, 50); }
  }, 200);
  bc.onmessage = (e) => { if (e.data?.type === 'changed') reload(); };
}

function fatal(err) {
  console.error(err);
  const v = qs('#view');
  if (v) v.innerHTML = `<div class="page"><div class="card error-card"><h1>Winlark could not start</h1><p>${esc(err?.message || String(err))}</p><p class="muted">Your data has not been changed. Try reloading. If this keeps happening, make sure the app is served from a web server (for example <code>npx serve .</code>) rather than opened as a file.</p><button type="button" class="btn btn--primary" onclick="location.reload()">Reload</button></div></div>`;
}

async function boot() {
  const { repo, persistent, error } = await createRepository();
  state.persistent = persistent;
  await loadAll(repo);
  applyAppearance();
  for (const [id, mod] of Object.entries(VIEWS)) registerView(id, mod);
  renderShell();
  installActions(document);
  installModalKeys();
  installShortcuts();
  installSortable();
  installTooltips();
  installGlobalHandlers();
  registerActions({
    'open-palette': () => openPalette(),
    'open-shortcuts': () => openShortcutHelp(),
    'nav-more': () => openMoreSheet(),
    'focus-mode': () => openFocusMode(),
    'focus-mode-exit': () => closeFocusMode(),
    'ambient-toggle': () => { unlockAudio(); audioUnlocked = true; ambientMuted = !!ambientPlaying(); if (!ambientMuted && state.settings.ambient.mode === 'focus' && timer.timerView().status !== 'running') toast('Ambient sound plays while a focus session runs.', { tone: 'info', duration: 2500 }); syncAmbient(); },
    'palette-create': async (_el, _e, text) => {
      const p = parseQuickAdd(text, { projects: listProjects() });
      if (!p.title) return;
      await createTask({ title: p.title, estimate: p.estimate, priority: p.priority || 'med', tags: p.tags, plannedDate: p.plannedDate !== undefined ? p.plannedDate : todayKey(), projectId: p.projectId });
      toast(`Added “${p.title}”.`, { tone: 'success' });
    },
  });

  if (!getMeta('initialized')) {
    await ensureDefaultStreaks();
    await setMeta('initialized', Date.now(), { silent: true });
  }
  await ensureOccurrences(todayKey());
  await timer.initTimer();

  on('data:changed', ({ stores }) => {
    if (stores.includes('settings')) { applyAppearance(); timer.settingsChanged(); syncAmbient(); }
    if (stores.includes('tasks')) timer.dataChanged();
    scheduleRender();
    if (isFocusMode()) renderFocusMode();
  });
  on('route:changed', () => { if (isFocusMode()) closeFocusMode(); scheduleRender(); });
  on('timer:state', () => { scheduleRender(); if (isFocusMode()) renderFocusMode(); syncAmbient(); });
  on('timer:tick', (v) => updateTimerDom(v));
  on('timer:second', () => { const s = state.settings.sound; const v = timer.timerView(); if (s.tick && v.mode === 'focus' && v.status === 'running') playTick(s.volume); });
  on('session:completed', onSessionCompleted);
  on('timer:error', (e) => toast(e.message, { tone: 'error' }));
  on('import:done', async () => { await ensureOccurrences(todayKey()); await timer.initTimer(); applyAppearance(); scheduleRender(); });

  const unlock = () => { audioUnlocked = unlockAudio(); syncAmbient(); };
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { timer.check(); checkDay(); } });
  window.addEventListener('focus', () => { timer.check(); checkDay(); });
  setInterval(checkDay, 30000);
  window.matchMedia?.('(prefers-reduced-motion: reduce)').addEventListener?.('change', applyAppearance);

  initRouter();
  document.body.classList.remove('is-booting');
  renderNow();
  renderMiniTimer();

  if (!persistent) {
    toast(`Your browser blocked local storage (${error || 'unknown reason'}). Winlark works, but data will be lost when you close this tab. Export a backup before leaving.`, { tone: 'error', duration: 20000 });
    qs('#storage-banner')?.removeAttribute('hidden');
  }
  setupTabSync();
  registerServiceWorker();
  setTimeout(offerLegacyImport, 300);
  window.__pomofocus = { state, timer, navigate, version: '2.0.0' }; // handy for debugging in DevTools
}

boot().catch(fatal);
export { all, toggleFocusMode };
