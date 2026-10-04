/**
 * Backup, restore, import and reset.
 *
 * Import is a three-step, non-destructive flow:
 *   parseBackupText()  → detect format (v2 or legacy v1), migrate, validate
 *   previewImport()    → counts + conflicts, nothing written yet
 *   applyImport()      → snapshot current data, then Replace or Merge
 *
 * Merge uses stable IDs: a record already present locally is only replaced
 * when the incoming copy has a newer updatedAt. Re-importing the same file is
 * therefore a no-op, and migrated legacy records (which carry their original
 * v1 timestamps) never overwrite edits made in 2.0.
 */
import { state, all, replaceAll, commit, mergeSettings } from '../core/state.js';
import { APP_NAME, LEGACY_APP_NAMES, APP_VERSION, DATA_SCHEMA_VERSION, DATA_COLLECTIONS } from '../core/constants.js';
import { isLegacyFormat, migrateLegacy } from './migration.js';
import { validateDataset } from '../utils/validation.js';
import { toKey } from '../utils/dates.js';
import { downloadFile } from '../utils/dom.js';
import { newId } from '../utils/ids.js';

const MAX_SNAPSHOTS = 8;

export function buildExport() {
  const out = {
    app: APP_NAME,
    schemaVersion: DATA_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
  };
  for (const name of DATA_COLLECTIONS) out[name] = all(name);
  return out;
}

export function exportFilename(prefix = 'winlark-backup') {
  const d = new Date();
  return `${prefix}-${toKey(d)}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}.json`;
}

export function downloadBackup() {
  const data = buildExport();
  downloadFile(exportFilename(), JSON.stringify(data, null, 2));
  return countDataset(data);
}

export function countDataset(d) {
  const counts = {};
  for (const name of DATA_COLLECTIONS) counts[name] = Array.isArray(d?.[name]) ? d[name].length : 0;
  return counts;
}

/**
 * Parse and validate a backup file's text without touching storage.
 * @returns {{ok, format, dataset, report, warnings, errors, counts}}
 */
export function parseBackupText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`This file is not valid JSON (${err.message}).`], warnings: [] };
  }
  return parseBackupObject(parsed);
}

export function parseBackupObject(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, errors: ['The file does not contain a Winlark backup.'], warnings: [] };
  }
  let format; let raw; let report = null;
  if ((parsed.app === APP_NAME || LEGACY_APP_NAMES.includes(parsed.app)) && Number.isFinite(Number(parsed.schemaVersion))) {
    const v = Number(parsed.schemaVersion);
    if (v > DATA_SCHEMA_VERSION) {
      return { ok: false, errors: [`This backup was made by a newer version of Winlark (format ${v}). Update the app to import it.`], warnings: [] };
    }
    format = `v${v}`;
    raw = parsed;
  } else if (isLegacyFormat(parsed)) {
    format = 'legacy-v1';
    const migrated = migrateLegacy(parsed);
    raw = migrated.dataset;
    report = migrated.report;
  } else {
    return { ok: false, errors: ['Unrecognised file. Expected a Winlark backup or a PomoFocus 1.x export.'], warnings: [] };
  }
  const { data, warnings, errors } = validateDataset(raw);
  if (errors.length || !data) return { ok: false, format, errors, warnings };
  return {
    ok: true,
    format,
    dataset: data,
    report,
    warnings: [...(report?.warnings || []), ...warnings],
    errors: [],
    counts: countDataset(data),
    exportedAt: parsed.exportedAt || null,
  };
}

/** Compare an incoming dataset with local data. */
export function previewImport(dataset) {
  const perStore = {};
  let newRecords = 0; let updates = 0; let keptLocal = 0; let identical = 0;
  for (const name of DATA_COLLECTIONS) {
    const s = { incoming: dataset[name].length, local: state[name].size, add: 0, update: 0, keepLocal: 0, same: 0 };
    for (const rec of dataset[name]) {
      const local = state[name].get(rec.id);
      if (!local) s.add++;
      else if ((rec.updatedAt || 0) > (local.updatedAt || 0)) s.update++;
      else if ((rec.updatedAt || 0) === (local.updatedAt || 0)) s.same++;
      else s.keepLocal++;
    }
    newRecords += s.add; updates += s.update; keptLocal += s.keepLocal; identical += s.same;
    perStore[name] = s;
  }
  const localTotal = DATA_COLLECTIONS.reduce((n, k) => n + state[k].size, 0);
  return { perStore, newRecords, updates, keptLocal, identical, localTotal };
}

/**
 * @param {object} dataset validated dataset
 * @param {'replace'|'merge'} mode
 */
export async function applyImport(dataset, mode, { includeSettings = mode === 'replace', reason = 'Before import' } = {}) {
  await createSnapshot(reason);
  if (mode === 'replace') {
    const ds = { ...dataset };
    if (!includeSettings) delete ds.settings;
    await replaceAll(ds, { keepSettings: !includeSettings || !dataset.settings });
    return { mode, added: DATA_COLLECTIONS.reduce((n, k) => n + dataset[k].length, 0), updated: 0, keptLocal: 0 };
  }
  const put = {};
  let added = 0; let updated = 0; let keptLocal = 0;
  for (const name of DATA_COLLECTIONS) {
    for (const rec of dataset[name]) {
      const local = state[name].get(rec.id);
      if (!local) { (put[name] ||= []).push(rec); added++; }
      else if ((rec.updatedAt || 0) > (local.updatedAt || 0)) { (put[name] ||= []).push(rec); updated++; }
      else keptLocal++;
    }
  }
  if (includeSettings && dataset.settings) put.settings = [{ ...mergeSettings(dataset.settings), id: 'app', updatedAt: Date.now() }];
  // Untouched first-run default streaks that duplicate an imported streak are dropped.
  const del = { streaks: [] };
  for (const local of state.streaks.values()) {
    if (!local.id.startsWith('k_default') || local.updatedAt !== local.createdAt) continue;
    if (dataset.streaks.some((s) => s.metric === local.metric && s.threshold === local.threshold && s.frequency === local.frequency)) del.streaks.push(local.id);
  }
  await commit({ put, del });
  return { mode, added, updated, keptLocal };
}

// ---------- snapshots (automatic safety backups kept inside IndexedDB) ----------
export async function createSnapshot(reason = 'Manual backup', payloadOverride = null) {
  const payload = payloadOverride ?? buildExport();
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const counts = typeof payload === 'string' ? null : countDataset(payload);
  const snap = { id: newId('snap'), createdAt: Date.now(), reason, counts, size: text.length, payload: text };
  await state.repo.bulkWrite({ put: { snapshots: [snap] } });
  await pruneSnapshots();
  return snap;
}

export async function listSnapshots() {
  const rows = await state.repo.getAll('snapshots');
  return rows.sort((a, b) => b.createdAt - a.createdAt).map(({ payload, ...meta }) => meta);
}

async function pruneSnapshots() {
  const rows = (await state.repo.getAll('snapshots')).sort((a, b) => b.createdAt - a.createdAt);
  const keep = [];
  let regular = 0;
  for (const r of rows) {
    // Legacy raw copies are kept until the user deletes them explicitly.
    if (r.reason?.startsWith('Legacy')) { keep.push(r.id); continue; }
    if (regular < MAX_SNAPSHOTS) { keep.push(r.id); regular++; }
  }
  const del = rows.filter((r) => !keep.includes(r.id)).map((r) => r.id);
  if (del.length) await state.repo.bulkWrite({ del: { snapshots: del } });
}

export async function getSnapshotPayload(id) {
  const snap = await state.repo.get('snapshots', id);
  return snap?.payload ?? null;
}

export async function deleteSnapshot(id) {
  await state.repo.bulkWrite({ del: { snapshots: [id] } });
}

export async function restoreSnapshot(id) {
  const text = await getSnapshotPayload(id);
  if (!text) throw new Error('That backup no longer exists.');
  const parsed = parseBackupText(text);
  if (!parsed.ok) throw new Error(parsed.errors.join(' '));
  await applyImport(parsed.dataset, 'replace', { includeSettings: true, reason: 'Before restoring a backup' });
  return parsed.counts;
}

export async function resetAllData() {
  await createSnapshot('Before reset');
  const empty = Object.fromEntries(DATA_COLLECTIONS.map((n) => [n, []]));
  await replaceAll(empty, { keepSettings: true });
  await state.repo.clear(['meta']);
  state.meta = new Map();
}

export async function estimateStorage() {
  try {
    if (navigator.storage?.estimate) {
      const { usage, quota } = await navigator.storage.estimate();
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      return { usage, quota, persisted };
    }
  } catch { /* unsupported */ }
  return null;
}
