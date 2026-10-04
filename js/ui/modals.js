/**
 * Modal dialogs: a stack (a confirm can open above an edit form), focus is
 * trapped inside the top dialog, Esc closes it, and focus returns to the
 * element that opened it. On narrow screens dialogs render as bottom sheets.
 */
import { esc } from '../utils/dom.js';
import { icon } from './icons.js';

const stack = [];
let seq = 0;
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function modalOpen() { return stack.length > 0; }

export function openModal({ title, body = '', footer = '', size = 'md', className = '', onMount, onClose, dismissible = true, subtitle = '' } = {}) {
  const root = document.getElementById('modal-root');
  const id = `modal-${++seq}`;
  const opener = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'modal-layer';
  wrap.innerHTML = `
    <div class="modal-backdrop" data-modal-dismiss></div>
    <div class="modal modal--${size} ${className}" role="dialog" aria-modal="true" aria-labelledby="${id}-title" tabindex="-1">
      <header class="modal__head">
        <div class="modal__titles">
          <h2 class="modal__title" id="${id}-title">${esc(title)}</h2>
          ${subtitle ? `<p class="modal__subtitle">${subtitle}</p>` : ''}
        </div>
        ${dismissible ? `<button type="button" class="icon-btn modal__close" data-modal-dismiss aria-label="Close">${icon('x')}</button>` : ''}
      </header>
      <div class="modal__body">${body}</div>
      ${footer ? `<footer class="modal__foot">${footer}</footer>` : ''}
    </div>`;
  root.appendChild(wrap);
  document.body.classList.add('has-modal');
  const dialog = wrap.querySelector('.modal');
  let resolveFn;
  const result = new Promise((r) => { resolveFn = r; });
  const entry = { wrap, dialog, opener, dismissible, close: null };

  const close = (value = null) => {
    const i = stack.indexOf(entry);
    if (i < 0) return;
    stack.splice(i, 1);
    wrap.classList.add('is-leaving');
    setTimeout(() => wrap.remove(), 160);
    if (!stack.length) document.body.classList.remove('has-modal');
    try { onClose?.(value); } catch (err) { console.error(err); }
    resolveFn(value);
    if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
  };
  entry.close = close;
  stack.push(entry);

  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-modal-dismiss]') && dismissible) close(null);
    const btn = e.target.closest('[data-modal-value]');
    if (btn) close(btn.dataset.modalValue);
  });
  try { onMount?.(dialog, close); } catch (err) { console.error(err); }
  requestAnimationFrame(() => {
    const auto = dialog.querySelector('[autofocus]') || dialog.querySelector('.modal__body ' + FOCUSABLE) || dialog;
    auto.focus({ preventScroll: true });
  });
  return { el: dialog, close, result };
}

export function closeTopModal() {
  const top = stack[stack.length - 1];
  if (top && top.dismissible) { top.close(null); return true; }
  return false;
}

export function closeAllModals() {
  while (stack.length) stack[stack.length - 1].close(null);
}

/** Focus trap + Esc, installed once. */
export function installModalKeys() {
  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      if (e.target.closest?.('[data-esc-local]')) return;
      e.preventDefault(); e.stopPropagation();
      closeTopModal();
      return;
    }
    if (e.key === 'Tab') {
      const items = [...top.dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !top.dialog.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !top.dialog.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    }
  }, true);
}

export function confirmDialog({ title = 'Are you sure?', message = '', details = '', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  const m = openModal({
    title, size: 'sm', className: 'modal--confirm',
    body: `${message ? `<p class="modal__message">${message}</p>` : ''}${details ? `<div class="modal__details">${details}</div>` : ''}`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-value="cancel">${esc(cancelLabel)}</button>
      <button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-modal-value="ok" autofocus>${esc(confirmLabel)}</button>`,
  });
  return m.result.then((v) => v === 'ok');
}

/** Ask the user to pick one of several outcomes. Resolves to the choice id or null. */
export function choiceDialog({ title, message = '', choices = [] }) {
  const m = openModal({
    title, size: 'sm', className: 'modal--confirm',
    body: message ? `<p class="modal__message">${message}</p>` : '',
    footer: `<button type="button" class="btn btn--ghost" data-modal-value="">Cancel</button>${choices.map((c, i) =>
      `<button type="button" class="btn ${c.danger ? 'btn--danger' : c.primary ? 'btn--primary' : 'btn--secondary'}" data-modal-value="${esc(c.id)}" ${i === choices.length - 1 ? 'autofocus' : ''}>${esc(c.label)}</button>`).join('')}`,
  });
  return m.result.then((v) => v || null);
}
