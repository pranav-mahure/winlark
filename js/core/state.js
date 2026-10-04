/**
 * Application state.
 *
 * The repository (IndexedDB today, an HTTP API later) is the source of truth.
 * At boot every collection is loaded into Maps here so views can render
 * synchronously. All writes go through commit(), which persists first and only
 * then updates memory — the UI can never show data that failed to save.
 *
 * `version` increments on every commit; derived/analytics caches key on it so
 * they are always rebuildable from the underlying records.
 */
import { DATA_COLLECTIONS, DEFAULT_SETTINGS } from './constants.js';
import { emit } from './events.js';

export const state = {
  repo: null,
  ready: false,
  version: 0,
  persistent: true,
  settings: structuredClone(DEFAULT_SETTINGS),
  meta: new Map(),
};
for (const name of DATA_COLLECTIONS) state[name] = new Map();

export function all(store) {
  return Array.from(state[store].values());
}

export function get(store, id) {
  if (id == null) return undefined;
  return state[store].get(id);
}

export function getMeta(id, fallback = null) {
  return state.meta.get(id)?.value ?? fallback;
}

export async function loadAll(repo) {
  state.repo = repo;
  for (const name of DATA_COLLECTIONS) {
    const rows = await repo.getAll(name);
    state[name] = new Map(rows.map((r) => [r.id, r]));
  }
  const metaRows = await repo.getAll('meta');
  state.meta = new Map(metaRows.map((r) => [r.id, r]));
  const s = await repo.get('settings', 'app');
  state.settings = mergeSettings(s);
  state.version++;
  state.ready = true;
}

/** Deep-merge stored settings over defaults so new settings get defaults. */
export function mergeSettings(stored) {
  const base = structuredClone(DEFAULT_SETTINGS);
  if (!stored || typeof stored !== 'object') return base;
  for (const [k, v] of Object.entries(stored)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
      base[k] = { ...base[k], ...v };
    } else if (k in base || k === 'createdAt' || k === 'updatedAt') {
      base[k] = v;
    }
  }
  base.id = 'app';
  return base;
}

/**
 * Commit a change set atomically.
 *   changes = { put: { tasks: [rec, ...] }, del: { sessions: [id, ...] } }
 * Returns the inverse change set (for Undo).
 */
export async function commit(changes, { silent = false } = {}) {
  const put = changes.put || {};
  const del = changes.del || {};
  const inverse = { put: {}, del: {} };
  const touched = new Set();

  for (const [store, records] of Object.entries(put)) {
    if (!records?.length) continue;
    touched.add(store);
    for (const rec of records) {
      if (store === 'settings' || store === 'meta') continue;
      const prev = state[store].get(rec.id);
      if (prev) (inverse.put[store] ||= []).push(prev);
      else (inverse.del[store] ||= []).push(rec.id);
    }
  }
  for (const [store, ids] of Object.entries(del)) {
    if (!ids?.length) continue;
    touched.add(store);
    for (const id of ids) {
      const prev = state[store]?.get(id);
      if (prev) (inverse.put[store] ||= []).push(prev);
    }
  }
  if (!touched.size) return inverse;

  await state.repo.bulkWrite({ put, del });

  for (const [store, records] of Object.entries(put)) {
    for (const rec of records || []) {
      if (store === 'settings') state.settings = mergeSettings(rec);
      else if (store === 'meta') state.meta.set(rec.id, rec);
      else state[store].set(rec.id, rec);
    }
  }
  for (const [store, ids] of Object.entries(del)) {
    for (const id of ids || []) {
      if (store === 'meta') state.meta.delete(id);
      else state[store]?.delete(id);
    }
  }
  state.version++;
  if (!silent) emit('data:changed', { stores: [...touched] });
  return inverse;
}

export async function setMeta(id, value, opts) {
  return commit({ put: { meta: [{ id, value, updatedAt: Date.now() }] } }, opts);
}

/** Replace every data collection (used by Replace import and Reset). */
export async function replaceAll(dataset, { keepSettings = false } = {}) {
  await state.repo.clear([...DATA_COLLECTIONS, ...(keepSettings ? [] : ['settings'])]);
  const put = {};
  for (const name of DATA_COLLECTIONS) put[name] = dataset[name] || [];
  if (!keepSettings && dataset.settings) put.settings = [{ ...mergeSettings(dataset.settings), id: 'app' }];
  await state.repo.bulkWrite({ put, del: {} });
  for (const name of DATA_COLLECTIONS) state[name] = new Map((dataset[name] || []).map((r) => [r.id, r]));
  if (!keepSettings && dataset.settings) state.settings = mergeSettings(dataset.settings);
  state.version++;
  emit('data:changed', { stores: [...DATA_COLLECTIONS, 'settings'] });
}

/**
 * Memoize a derived computation on state.version. Analytics are always a
 * pure function of the stored records, so "recalculate analytics" is simply
 * clearing these caches.
 */
const memoRegistry = new Set();
export function memo(fn) {
  let cachedVersion = -1;
  let cache = new Map();
  const wrapped = (...args) => {
    if (cachedVersion !== state.version) { cache = new Map(); cachedVersion = state.version; }
    const key = args.length ? JSON.stringify(args) : '_';
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key);
  };
  wrapped.clear = () => { cachedVersion = -1; };
  memoRegistry.add(wrapped);
  return wrapped;
}

export function clearDerivedCaches() {
  for (const m of memoRegistry) m.clear();
  state.version++;
}
