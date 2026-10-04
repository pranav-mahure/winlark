/** Toasts (polite live region) with an optional action such as Undo. */
import { esc } from '../utils/dom.js';
import { icon } from './icons.js';
import { commit } from '../core/state.js';

let root = null;
const MAX = 4;

function ensureRoot() {
  if (!root) root = document.getElementById('toast-root');
  return root;
}

export function toast(message, { tone = 'info', action = null, duration = 5000 } = {}) {
  const r = ensureRoot();
  if (!r) { console.log('[toast]', message); return () => {}; }
  const el = document.createElement('div');
  el.className = `toast toast--${tone}`;
  el.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  const ic = tone === 'error' ? 'info' : tone === 'success' ? 'check' : tone === 'win' ? 'starFill' : 'info';
  el.innerHTML = `<span class="toast__icon">${icon(ic, { size: 16 })}</span><span class="toast__msg">${esc(message)}</span>${
    action ? `<button type="button" class="toast__action">${esc(action.label)}</button>` : ''
  }<button type="button" class="toast__close" aria-label="Dismiss">${icon('x', { size: 14 })}</button>`;
  let timer = null;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector('.toast__close').addEventListener('click', close);
  if (action) {
    el.querySelector('.toast__action').addEventListener('click', async () => {
      close();
      try { await action.run(); } catch (err) { console.error(err); toast(err.message || 'That did not work.', { tone: 'error' }); }
    });
  }
  const arm = () => { timer = setTimeout(close, action ? Math.max(duration, 7000) : duration); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', arm);
  el.addEventListener('focusin', () => clearTimeout(timer));
  r.appendChild(el);
  while (r.children.length > MAX) r.firstElementChild.remove();
  arm();
  return close;
}

/** Toast that can revert a committed change set (the inverse returned by commit()). */
export function undoToast(message, inverse, { onUndo } = {}) {
  return toast(message, {
    tone: 'success',
    action: inverse ? {
      label: 'Undo',
      run: async () => { await commit(inverse); onUndo?.(); toast('Restored.', { tone: 'success', duration: 2500 }); },
    } : null,
  });
}

export function errorToast(err, fallback = 'Something went wrong.') {
  const msg = err?.name === 'ValidationError' ? err.message : (err?.message ? `${fallback} ${err.message}` : fallback);
  if (err?.name !== 'ValidationError') console.error(err);
  return toast(msg, { tone: 'error', duration: 7000 });
}
