/**
 * Stable, collision-resistant local IDs.
 *
 * IDs are strings with a short type prefix ("t_", "o_", ...) so they stay
 * readable in exports and debugging, and can later be stored as TEXT primary
 * keys in PostgreSQL without translation. Legacy IDs are mapped
 * deterministically by the migration layer, never through this function.
 */
export function newId(prefix = 'x') {
  let core;
  if (globalThis.crypto && typeof crypto.randomUUID === 'function') {
    core = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  } else {
    core = Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }
  return `${prefix}_${core}`;
}

/** Small deterministic string hash (FNV-1a, base36) for derived legacy IDs. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}
