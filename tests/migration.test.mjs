// Node regression test: migrate the real v1 export and verify invariants.
import { readFileSync } from 'node:fs';
import { migrateLegacy, isLegacyFormat } from '../js/storage/migration.js';
import { validateDataset } from '../js/utils/validation.js';

const file = process.argv[2] || process.env.POMO_LEGACY || 'pomofocus-2026-09-30.json';
const legacy = JSON.parse(readFileSync(file, 'utf8'));
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`); if (!cond) failures++; };

ok(isLegacyFormat(legacy), 'detected as legacy format');
const { dataset, report } = migrateLegacy(legacy);
const { data, warnings, errors } = validateDataset(dataset);
ok(errors.length === 0, `validation errors: ${errors.join('; ') || 'none'}`);
console.log('validation warnings:', warnings);
console.log('report.checks:', report.checks.map(c => `${c.ok ? '✓' : '✗'} ${c.label} (${c.detail})`));
console.log('report.notes:', report.notes);
console.log('report.warnings:', report.warnings);

ok(data.projects.length === 5, `5 projects (${data.projects.length})`);
ok(['College Sutdy','ML study Personal','DSA','mental traning','SELF ImP,BOOK,ETC'].every(n => data.projects.some(p => p.name === n)), 'project names preserved exactly');
ok(data.tasks.length === 68, `68 tasks (${data.tasks.length})`);
ok(data.sessions.length === 546, `546 sessions = v1 totalPomos (${data.sessions.length})`);
const focusMin = data.sessions.reduce((s, x) => s + x.actualDuration, 0) / 60;
ok(Math.round(focusMin) === 16145, `16145 focus min (${focusMin})`);
ok(data.sessions.filter(s => s.taskId).length === 536, 'task-attributed sessions = 536');
ok(data.sessions.filter(s => !s.taskId).length === 10, 'unassigned legacy sessions = 10');
ok(report.checks.every(c => c.ok), 'all migration self-checks pass');

// per-day equality with dailyStats
let dayBad = 0;
for (const [date, ds] of Object.entries(legacy.dailyStats)) {
  const ss = data.sessions.filter(s => s.date === date);
  const min = ss.reduce((a, s) => a + s.actualDuration, 0) / 60;
  if (ss.length !== ds.pomos || Math.round(min) !== ds.focusMin) dayBad++;
  for (const [pid, bp] of Object.entries(ds.byProject || {})) {
    const n = ss.filter(s => (s.projectId || '__none__') === pid && s.taskId).length;
    if (n !== bp.pomos) dayBad++;
  }
}
ok(dayBad === 0, `per-day & per-project counts match dailyStats (${dayBad} mismatches)`);

// Completion state preserved, independent of progress
const byLegacy = new Map(data.tasks.map(t => [String(t.legacy.id), t]));
let doneMismatch = 0, notesBad = 0, prioBad = 0, projBad = 0, sessBad = 0;
for (const lt of legacy.tasks) {
  const t = byLegacy.get(String(lt.id));
  const recurring = lt.recurring !== 'none';
  if (!recurring && (t.status === 'completed') !== lt.done) doneMismatch++;
  if (t.notes !== lt.notes) notesBad++;
  if (t.priority !== lt.priority) prioBad++;
  if ((t.projectId || '') !== (lt.projectId || '')) projBad++;
  const mine = data.sessions.filter(s => s.taskId === t.id).map(s => s.date).sort();
  const theirs = lt.sessions.map(s => s.date).sort();
  if (JSON.stringify(mine) !== JSON.stringify(theirs)) sessBad++;
}
ok(doneMismatch === 0, 'done flags preserved exactly (incl. done with 3/4 Pomodoros)');
ok(notesBad === 0, 'notes preserved'); ok(prioBad === 0, 'priorities preserved'); ok(projBad === 0, 'project links preserved');
ok(sessBad === 0, 'every task keeps its exact session dates');
const se4 = data.tasks.find(t => t.title === 'Se Unit 4');
ok(se4.status === 'completed' && se4.estimate === 4 && data.sessions.filter(s => s.taskId === se4.id).length === 3, 'Se Unit 4: completed, estimate 4, actual 3');
ok(data.tasks.filter(t => t.kind === 'series').length === 4, '4 recurring series');
ok(data.tasks.filter(t => t.status === 'completed' && !t.completedDate).length === 0, 'every completed task has a completion date from v1 history');
ok(data.activity.length === 97, `97 activity events (${data.activity.length})`);
ok(data.sessions.every(s => s.startTime === null && s.source === 'legacy'), 'no invented timestamps');

// Determinism / idempotency
const again = validateDataset(migrateLegacy(JSON.parse(readFileSync(file, 'utf8'))).dataset).data;
const ids = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => Array.isArray(d[k])).map(([k, v]) => [k, v.map(r => r.id).sort().join(',')]));
ok(JSON.stringify(ids(again)) === JSON.stringify(ids(data)), 'deterministic IDs across runs');
ok(JSON.stringify(again.tasks) === JSON.stringify(data.tasks), 'byte-identical task records across runs');
const allIds = data.sessions.map(s => s.id); ok(new Set(allIds).size === allIds.length, 'session IDs unique');
console.log('settings:', JSON.stringify(data.settings));
console.log('completion counting:', data.activity.filter(a => a.countsAsCompletion).length, 'events count as completions;', data.activity.filter(a=>!a.taskId).map(a=>a.title));
console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASS');
process.exit(failures ? 1 : 0);
