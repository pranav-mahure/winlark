/**
 * Event delegation. Markup declares intent with attributes and handlers are
 * registered by name — no inline event handlers, and re-rendered HTML keeps
 * working without re-binding.
 *
 *   <button data-action="task-complete" data-id="…">   click
 *   <select data-change="filter-project">                change
 *   <input data-input="search">                          input
 *   <form data-submit="quick-add">                       submit (FormData passed)
 */
import { errorToast } from './toast.js';

const handlers = new Map();

export function registerActions(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (handlers.has(name)) console.warn(`[actions] "${name}" registered twice`);
    handlers.set(name, fn);
  }
}

export async function runAction(name, el = null, event = null, extra) {
  const fn = handlers.get(name);
  if (!fn) { console.warn(`[actions] no handler for "${name}"`); return; }
  try {
    return await fn(el, event, extra);
  } catch (err) {
    errorToast(err, 'That action could not be completed.');
  }
}

export function hasAction(name) { return handlers.has(name); }

export function installActions(root = document) {
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.tagName === 'A' && (e.metaKey || e.ctrlKey)) return;
    if (el.tagName === 'A' || el.type === 'submit' || el.dataset.prevent !== undefined) e.preventDefault();
    if (el.dataset.stop !== undefined) e.stopPropagation();
    runAction(el.dataset.action, el, e);
  });
  root.addEventListener('change', (e) => {
    const el = e.target.closest('[data-change]');
    if (el) runAction(el.dataset.change, el, e);
  });
  root.addEventListener('input', (e) => {
    const el = e.target.closest('[data-input]');
    if (el) runAction(el.dataset.input, el, e);
  });
  root.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-submit]');
    if (!form) return;
    e.preventDefault();
    runAction(form.dataset.submit, form, e, new FormData(form));
  });
}
