/**
 * Repository interface.
 *
 * Feature code never touches IndexedDB directly; it goes through core/state.js,
 * which calls one of these. To move to FastAPI + PostgreSQL later, implement
 * the same five methods against HTTP endpoints, e.g.
 *
 *   class ApiRepository {
 *     getAll(store)            → GET    /api/{store}
 *     get(store, id)           → GET    /api/{store}/{id}
 *     bulkWrite({put, del})    → POST   /api/batch   (one DB transaction server-side)
 *     clear(stores)            → DELETE /api/{store}
 *     count(store)             → GET    /api/{store}/count
 *   }
 *
 * and swap it in createRepository(). Nothing else changes.
 */
import { openDatabase, idbAvailable, requestPromise, txDone } from './db.js';
import { STORES } from '../core/constants.js';

export class IndexedDBRepository {
  constructor(db) { this.db = db; this.kind = 'indexeddb'; }

  static async open() {
    const db = await openDatabase();
    return new IndexedDBRepository(db);
  }

  async getAll(store) {
    const tx = this.db.transaction(store, 'readonly');
    return requestPromise(tx.objectStore(store).getAll());
  }

  async get(store, id) {
    const tx = this.db.transaction(store, 'readonly');
    return requestPromise(tx.objectStore(store).get(id));
  }

  async count(store) {
    const tx = this.db.transaction(store, 'readonly');
    return requestPromise(tx.objectStore(store).count());
  }

  /** Writes all puts/deletes across stores in ONE transaction (all or nothing). */
  async bulkWrite({ put = {}, del = {} }) {
    const names = [...new Set([...Object.keys(put), ...Object.keys(del)])]
      .filter((n) => (put[n]?.length || del[n]?.length));
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    const done = txDone(tx);
    for (const n of names) {
      const os = tx.objectStore(n);
      for (const rec of put[n] || []) os.put(rec);
      for (const id of del[n] || []) os.delete(id);
    }
    await done;
  }

  async clear(stores) {
    const names = stores.filter((s) => s in STORES);
    if (!names.length) return;
    const tx = this.db.transaction(names, 'readwrite');
    const done = txDone(tx);
    for (const n of names) tx.objectStore(n).clear();
    await done;
  }
}

/** Fallback when IndexedDB is unavailable (private mode in some browsers). Data lives only for this tab. */
export class MemoryRepository {
  constructor() {
    this.kind = 'memory';
    this.stores = Object.fromEntries(Object.keys(STORES).map((k) => [k, new Map()]));
  }
  async getAll(store) { return [...this.stores[store].values()].map((r) => structuredClone(r)); }
  async get(store, id) { const r = this.stores[store].get(id); return r ? structuredClone(r) : undefined; }
  async count(store) { return this.stores[store].size; }
  async bulkWrite({ put = {}, del = {} }) {
    for (const [n, recs] of Object.entries(put)) for (const r of recs || []) this.stores[n].set(r.id, structuredClone(r));
    for (const [n, ids] of Object.entries(del)) for (const id of ids || []) this.stores[n].delete(id);
  }
  async clear(stores) { for (const n of stores) this.stores[n]?.clear(); }
}

export async function createRepository() {
  if (!idbAvailable()) {
    console.warn('[repo] IndexedDB not available — using in-memory storage.');
    return { repo: new MemoryRepository(), persistent: false, error: 'IndexedDB is not available in this browser.' };
  }
  try {
    const repo = await IndexedDBRepository.open();
    return { repo, persistent: true };
  } catch (err) {
    console.error('[repo] Could not open IndexedDB', err);
    return { repo: new MemoryRepository(), persistent: false, error: err?.message || String(err) };
  }
}
