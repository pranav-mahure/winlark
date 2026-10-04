// Node smoke test: render every view (HTML strings) against migrated legacy data.
import { readFileSync } from 'node:fs';
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, documentElement: { dataset: {} } };
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);
const { MemoryRepository } = await import('../js/storage/repository.js');
const { loadAll, replaceAll } = await import('../js/core/state.js');
const { parseBackupText } = await import('../js/storage/backup.js');
const { ensureOccurrences } = await import('../js/features/tasks.js');
const { todayKey } = await import('../js/utils/dates.js');
await loadAll(new MemoryRepository());
const parsed = parseBackupText(readFileSync((process.argv[2] || process.env.POMO_LEGACY || 'pomofocus-2026-09-30.json'), 'utf8'));
await replaceAll(parsed.dataset);
await ensureOccurrences(todayKey());
const routes = [
  ['today', []], ['plan', []], ['plan', [todayKey()]], ['tasks', []], ['objectives', []], ['habits', []], ['calendar', []],
  ['analytics', []], ['analytics', ['focus']], ['analytics', ['tasks']], ['analytics', ['objectives']], ['analytics', ['habits']],
  ['analytics', ['projects']], ['analytics', ['planning']], ['analytics', ['streaks']], ['projects', []], ['projects', ['p1781757649155']],
  ['history', []], ['settings', []], ['review', ['2026-09-30']], ['review', []],
];
let fail = 0;
for (const [r, parts] of routes) {
  const mod = await import(`../js/views/${r}.js`);
  for (const query of [{}, r === 'analytics' ? { period: 'year' } : null, r === 'tasks' ? { when: 'overdue' } : null].filter(Boolean)) {
    try {
      const html = mod.render({ route: r, parts, query });
      if (typeof html !== 'string' || html.length < 100) throw new Error('empty html');
      if (/undefined|NaN|\[object Object\]/.test(html.replace(/data-[a-z-]+="undefined"/g, ''))) {
        const m = html.match(/.{60}(undefined|NaN|\[object Object\]).{40}/);
        console.log(`WARN  ${r}/${parts.join('/')} contains suspicious text: ${m ? m[0] : ''}`);
      }
      console.log(`PASS  ${r}/${parts.join('/')} ${JSON.stringify(query)} (${html.length} chars)`);
    } catch (e) { fail++; console.log(`FAIL  ${r}/${parts.join('/')}: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); }
  }
}
console.log(fail ? `${fail} FAILED` : 'ALL PASS');
process.exit(fail ? 1 : 0);
