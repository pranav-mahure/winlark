// Backups must keep importing across the PomoFocus -> Winlark rename, and the
// internal storage identifiers (which hold users' data) must not change.
import { readFileSync } from 'node:fs';
import { parseBackupObject, parseBackupText, buildExport } from '../js/storage/backup.js';
import { APP_NAME, LEGACY_APP_NAMES, DB_NAME, LEGACY_STORAGE_KEY } from '../js/core/constants.js';
import { MemoryRepository } from '../js/storage/repository.js';
import { loadAll, replaceAll } from '../js/core/state.js';

let failures = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) failures++; };

const file = process.argv[2] || process.env.POMO_LEGACY || 'pomofocus-2026-09-30.json';
await loadAll(new MemoryRepository());
const legacy = parseBackupText(readFileSync(file, 'utf8'));
await replaceAll(legacy.dataset);

const fresh = buildExport();
ok(fresh.app === 'Winlark' && APP_NAME === 'Winlark', 'new exports are labelled "Winlark"');
ok(parseBackupObject(JSON.parse(JSON.stringify(fresh))).ok, 'a new Winlark export imports');

const old = JSON.parse(JSON.stringify(fresh)); old.app = 'PomoFocus';
const r = parseBackupObject(old);
ok(LEGACY_APP_NAMES.includes('PomoFocus') && r.ok, 'a backup made before the rename (app: "PomoFocus") still imports');
ok(r.ok && r.dataset.sessions.length === fresh.sessions.length && r.dataset.tasks.length === fresh.tasks.length, 'old-name backup keeps every session and task');

const other = JSON.parse(JSON.stringify(fresh)); other.app = 'SomethingElse';
ok(!parseBackupObject(other).ok, 'a file from another app is still rejected');
ok(parseBackupText(readFileSync(file, 'utf8')).ok, 'the original PomoFocus 1.x export still imports');

ok(DB_NAME === 'pomofocus', 'IndexedDB name unchanged ("pomofocus") so existing data is still found');
ok(LEGACY_STORAGE_KEY === 'pomofocus_data', 'v1 localStorage key unchanged ("pomofocus_data")');
console.log(failures ? `${failures} FAILED` : 'ALL PASS');
process.exit(failures ? 1 : 0);
