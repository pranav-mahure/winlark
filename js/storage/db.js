/**
 * IndexedDB bootstrap with explicit, ordered schema upgrades.
 *
 * To evolve the schema: bump DB_VERSION in constants.js and append a function
 * to UPGRADES. Each step receives the versionchange transaction, so it can
 * create stores/indexes or rewrite records. Steps run in order from the
 * user's current version, so a v1 database upgrades through v2, v3, ...
 */
import { DB_NAME, DB_VERSION, STORES } from '../core/constants.js';

// Diagnostics only on localhost/127.0.0.1 (development); silent in production.
const DEBUG = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);
const log = (...a) => { if (DEBUG) console.info('[Winlark DB]', ...a); };

const UPGRADES = {
  // v0 → v1: initial PomoFocus 2.0 schema
  1(db) {
    for (const [name, spec] of Object.entries(STORES)) {
      if (db.objectStoreNames.contains(name)) continue;
      const store = db.createObjectStore(name, { keyPath: 'id' });
      for (const idx of spec.indexes) store.createIndex(idx, idx, { unique: false });
    }
  },
  // Example for the future:
  // 2(db, tx) { tx.objectStore('tasks').createIndex('dueDate', 'dueDate'); },
};

export function idbAvailable() {
  try { return typeof indexedDB !== 'undefined' && indexedDB !== null; } catch { return false; }
}

export function openDatabase({ name = DB_NAME, version = DB_VERSION } = {}) {
  return new Promise((resolve, reject) => {
    let req;
    log(`opening database "${name}" (version ${version})`);
    try {
      req = indexedDB.open(name, version);
    } catch (err) {
      console.error('[Winlark DB] indexedDB.open threw', err);
      reject(err);
      return;
    }
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      log(`upgrading from version ${event.oldVersion} to ${version}`);
      for (let v = event.oldVersion + 1; v <= version; v++) {
        const step = UPGRADES[v];
        if (step) step(db, tx);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      log(`database opened: "${db.name}" v${db.version}, stores: ${[...db.objectStoreNames].join(', ')}`);
      db.onversionchange = () => {
        db.close();
        console.warn('[db] A newer version of Winlark opened in another tab; this tab closed its connection.');
      };
      resolve(db);
    };
    req.onerror = () => {
      console.error('[Winlark DB] open failed', req.error);
      reject(req.error || new Error('IndexedDB open failed'));
    };
    req.onblocked = () => console.warn('[db] Database upgrade blocked by another open tab. Close other Winlark tabs.');
  });
}

export function requestPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}
