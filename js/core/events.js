/**
 * Minimal publish/subscribe bus. Feature modules emit domain events; the UI
 * layer subscribes. Keeps features unaware of rendering.
 *
 * Events in use:
 *   data:changed   { stores: string[] }       after any committed mutation
 *   timer:tick     view                        ~4×/s while the timer runs
 *   timer:state    view                        on start/pause/complete/etc.
 *   session:completed { session }
 *   day:changed    { from, to }                local date rolled over
 *   route:changed  { route, params }
 */
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  listeners.get(event)?.delete(fn);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of [...set]) {
    try { fn(payload); } catch (err) { console.error(`[events] listener for "${event}" failed`, err); }
  }
}
