/**
 * Rendering. Views are modules with render(route) → HTML and optional
 * mount(root, route). Renders are batched to one per animation frame and
 * keep keyboard focus (and caret position) on the same control.
 */
import { qs, qsa } from '../utils/dom.js';
import { currentRoute } from './router.js';
import { mountCharts } from './charts.js';
import { ROUTES } from '../core/constants.js';
import { timerView } from '../features/timer.js';
import { miniTimer, updateTimerDom } from './timer-ui.js';
import { closeMenu } from './components.js';

const views = new Map();
let pending = false;
let lastRouteKey = '';

export function registerView(id, mod) { views.set(id, mod); }

export function scheduleRender() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; renderNow(); });
}

function focusDescriptor() {
  const a = document.activeElement;
  if (!a || a === document.body || !qs('#app')?.contains(a)) return null;
  const d = { sel: null, start: null, end: null };
  if (a.id) d.sel = `#${CSS.escape(a.id)}`;
  else if (a.dataset.focusKey) d.sel = `[data-focus-key="${CSS.escape(a.dataset.focusKey)}"]`;
  else if (a.dataset.action) d.sel = `[data-action="${CSS.escape(a.dataset.action)}"]${a.dataset.id ? `[data-id="${CSS.escape(a.dataset.id)}"]` : ''}${a.dataset.value ? `[data-value="${CSS.escape(a.dataset.value)}"]` : ''}`;
  else if (a.name) d.sel = `[name="${CSS.escape(a.name)}"]`;
  try { if (typeof a.selectionStart === 'number') { d.start = a.selectionStart; d.end = a.selectionEnd; } } catch { /* not a text input */ }
  return d.sel ? d : null;
}

export function renderNow() {
  const route = currentRoute();
  const view = views.get(route.route) || views.get('today');
  const root = qs('#view');
  if (!root || !view) return;
  const routeKey = `${route.route}/${route.parts.join('/')}`;
  const routeChanged = routeKey !== lastRouteKey;
  const focus = routeChanged ? null : focusDescriptor();
  const scrollY = window.scrollY;
  closeMenu();
  let html;
  try {
    html = view.render(route);
  } catch (err) {
    console.error('[render] view failed', err);
    html = `<div class="page"><div class="card error-card"><h1>Something went wrong showing this page</h1><p>Your data is safe. Try another page or reload.</p><pre class="error-detail">${String(err?.message || err).replace(/[<>&]/g, '')}</pre><a class="btn btn--primary" href="#/today">Back to Today</a></div></div>`;
  }
  root.innerHTML = html;
  root.dataset.route = route.route;
  document.body.dataset.route = route.route;
  try { view.mount?.(root, route); } catch (err) { console.error('[render] mount failed', err); }
  mountCharts(root);
  updateNav(route.route);
  renderMiniTimer();
  if (routeChanged) {
    lastRouteKey = routeKey;
    window.scrollTo(0, 0);
    const h = root.querySelector('h1');
    if (h && document.activeElement !== qs('#quick-add-input')) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
  } else {
    window.scrollTo(0, scrollY);
    if (focus) {
      const el = root.querySelector(focus.sel) || document.querySelector(`#app ${focus.sel}`);
      if (el) {
        el.focus({ preventScroll: true });
        if (focus.start != null) { try { el.setSelectionRange(focus.start, focus.end); } catch { /* ignore */ } }
      }
    }
  }
  updateTimerDom(timerView());
}

export function updateNav(active) {
  for (const a of qsa('[data-nav]')) {
    const on = a.dataset.nav === active || (active === 'review' && a.dataset.nav === 'calendar');
    a.classList.toggle('is-active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  }
  const more = qs('[data-nav-more]');
  if (more) {
    const primary = ['today', 'plan', 'tasks', 'calendar'];
    more.classList.toggle('is-active', !primary.includes(active));
  }
}

export function renderMiniTimer() {
  const el = qs('#mini-timer');
  if (!el) return;
  const v = timerView();
  const route = currentRoute().route;
  const show = v.status !== 'idle' && route !== 'today';
  el.hidden = !show;
  if (show) el.innerHTML = miniTimer(v);
}

export function routeTitle(id) { return ROUTES.find((r) => r.id === id)?.label || 'Winlark'; }
