/**
 * Reordering lists — pointer-based drag (mouse, pen and touch alike) plus a
 * keyboard alternative: Alt+↑ / Alt+↓ on any focused row. Menus also offer
 * "Move up / Move down" buttons, so reordering never requires dragging.
 *
 *   <ul data-sortable="today">  <li data-sort-item data-id="…"> <span class="drag-handle">
 *   registerSortable('today', (ids, listEl) => saveOrder(ids))
 */
const handlers = new Map();
let drag = null;

export function registerSortable(key, fn) { handlers.set(key, fn); }

function itemsOf(list) { return [...list.querySelectorAll(':scope > [data-sort-item]')]; }

function finish(list) {
  const fn = handlers.get(list.dataset.sortable);
  const ids = itemsOf(list).map((el) => el.dataset.id);
  if (fn) Promise.resolve(fn(ids, list)).catch((err) => console.error('[dnd] reorder failed', err));
}

function onPointerDown(e) {
  const handle = e.target.closest('.drag-handle');
  if (!handle || e.button > 0) return;
  const item = handle.closest('[data-sort-item]');
  const list = item?.parentElement;
  if (!item || !list?.dataset.sortable) return;
  e.preventDefault();
  const before = itemsOf(list).map((el) => el.dataset.id).join('|');
  drag = { item, list, before, pointerId: e.pointerId, startY: e.clientY, moved: false };
  handle.setPointerCapture?.(e.pointerId);
  item.classList.add('is-dragging');
  list.classList.add('is-sorting');
}

function onPointerMove(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  if (Math.abs(e.clientY - drag.startY) > 3) drag.moved = true;
  const siblings = itemsOf(drag.list).filter((el) => el !== drag.item);
  let target = null;
  for (const el of siblings) {
    const r = el.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { target = el; break; }
  }
  if (target) { if (drag.item.nextElementSibling !== target) drag.list.insertBefore(drag.item, target); }
  else {
    const last = siblings[siblings.length - 1];
    if (last && last.nextElementSibling !== drag.item) last.after(drag.item);
  }
  // auto-scroll near viewport edges
  const edge = 60;
  if (e.clientY < edge) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
}

function onPointerUp(e) {
  if (!drag || e.pointerId !== drag.pointerId) return;
  const { item, list, before } = drag;
  drag = null;
  item.classList.remove('is-dragging');
  list.classList.remove('is-sorting');
  const after = itemsOf(list).map((el) => el.dataset.id).join('|');
  if (after !== before) finish(list);
}

function onKeyDown(e) {
  if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const item = e.target.closest?.('[data-sort-item]');
  const list = item?.parentElement;
  if (!item || !list?.dataset.sortable) return;
  e.preventDefault();
  const items = itemsOf(list);
  const i = items.indexOf(item);
  const j = e.key === 'ArrowUp' ? i - 1 : i + 1;
  if (j < 0 || j >= items.length) return;
  const focusKey = document.activeElement?.dataset?.action;
  if (e.key === 'ArrowUp') list.insertBefore(item, items[j]); else items[j].after(item);
  item.querySelector(focusKey ? `[data-action="${focusKey}"]` : 'button')?.focus();
  const live = document.getElementById('sr-live');
  if (live) live.textContent = `Moved to position ${j + 1} of ${items.length}`;
  finish(list);
}

export function installSortable() {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('pointercancel', onPointerUp);
  document.addEventListener('keydown', onKeyDown);
}
