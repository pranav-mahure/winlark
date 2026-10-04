/**
 * Hash router: #/route/param?key=value. Hash routing works on any static
 * server (no rewrite rules) and offline from the service-worker cache.
 */
import { emit } from '../core/events.js';
import { ROUTES } from '../core/constants.js';

const KNOWN = new Set([...ROUTES.map((r) => r.id), 'review']);
let current = { route: 'today', parts: [], query: {} };

export function parseHash(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
  const route = KNOWN.has(segs[0]) ? segs[0] : 'today';
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { route, parts: KNOWN.has(segs[0]) ? segs.slice(1) : [], query };
}

export function buildHash(route, parts = [], query = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
  return `#/${[route, ...parts].map(encodeURIComponent).join('/')}${q ? `?${q}` : ''}`;
}

export function navigate(target, { replace = false } = {}) {
  const hash = target.startsWith('#') ? target : `#/${target.replace(/^\//, '')}`;
  if (hash === location.hash) { handle(); return; }
  if (replace) { history.replaceState(null, '', hash); handle(); }
  else location.hash = hash;
}

/** Update query params of the current route without adding history entries. */
export function setQuery(patch) {
  const q = { ...current.query, ...patch };
  history.replaceState(null, '', buildHash(current.route, current.parts, q));
  current = parseHash();
  emit('route:changed', { ...current, soft: true });
}

export function currentRoute() { return current; }

function handle() {
  const prev = current;
  current = parseHash();
  emit('route:changed', { ...current, prev });
}

export function initRouter() {
  window.addEventListener('hashchange', handle);
  if (!location.hash) history.replaceState(null, '', '#/today');
  current = parseHash();
}
