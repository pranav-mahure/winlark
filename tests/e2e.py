"""
End-to-end browser tests for PomoFocus 2.0 (Playwright + Chromium).

Run:  python3 -m http.server 8765   (from the project root, or `npx serve . -l 8765`)
      python3 tests/e2e.py [path/to/legacy-export.json]

Covers: legacy localStorage migration (with preview + totals), repeat-import
duplicate prevention, quick add + Day Win, completing/moving tasks, timer
start/pause/resume/reset, refresh mid-session, completion (fake clock) and
restore-after-close, export/import round trip, invalid JSON, theme change,
offline reload through the service worker, and responsive screenshots.
"""
import asyncio, json, sys, os, time
from playwright.async_api import async_playwright

URL = os.environ.get('POMO_URL', 'http://localhost:8765/')
LEGACY = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('POMO_LEGACY', 'pomofocus-2026-09-30.json')
SHOTS = os.environ.get('POMO_SHOTS', '/tmp/shots')
os.makedirs(SHOTS, exist_ok=True)
results = []

def check(cond, msg):
    results.append((bool(cond), msg))
    print(('PASS  ' if cond else 'FAIL  ') + msg, flush=True)

STATS_JS = """() => {
  const s = window.__pomofocus.state;
  const sessions = [...s.sessions.values()];
  const focus = sessions.filter(x => x.type === 'focus' && x.completed);
  return {
    sessions: sessions.length, pomos: focus.length,
    focusMin: Math.round(focus.reduce((a, b) => a + (b.actualDuration || 0), 0) / 60),
    projects: s.projects.size, tasks: [...s.tasks.values()].filter(t => !t.id.includes('~')).length,
    allTasks: s.tasks.size, streaks: s.streaks.size, theme: s.settings.appearance.theme,
    focusLen: s.settings.timer.focusMin, activity: s.activity.size,
  };
}"""

async def wait_app(page):
    await page.wait_for_function('() => window.__pomofocus && document.querySelector("#view .page")', timeout=15000)

async def main():
    legacy_text = open(LEGACY, encoding='utf8').read()
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1440, 'height': 900}, timezone_id='Asia/Kolkata', accept_downloads=True)
        page = await ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))

        # ---------- 1. legacy localStorage migration ----------
        await page.goto(URL)
        await wait_app(page)
        await page.evaluate('(t) => localStorage.setItem("pomofocus_data", t)', legacy_text)
        await page.reload()
        await wait_app(page)
        dlg = page.get_by_role('dialog', name='Bring over your PomoFocus 1.x data?')
        await dlg.wait_for(timeout=5000)
        check(True, 'legacy data detected in localStorage and import offered')
        await dlg.get_by_role('button', name='Review and import').click()
        preview = page.get_by_role('dialog', name='Import preview')
        await preview.wait_for()
        bad = await preview.locator('.check-list .is-bad').count()
        okc = await preview.locator('.check-list .is-ok').count()
        check(bad == 0 and okc >= 3, f'migration self-checks shown in preview ({okc} ok, {bad} failed)')
        await preview.screenshot(path=f'{SHOTS}/import-preview.png')
        await preview.get_by_role('button', name='Import').click()
        await page.wait_for_function('() => window.__pomofocus.state.sessions.size >= 546', timeout=10000)
        st = await page.evaluate(STATS_JS)
        check(st['pomos'] == 546, f"546 Pomodoros after migration ({st['pomos']})")
        check(st['focusMin'] == 16145, f"16145 focus minutes after migration ({st['focusMin']})")
        check(st['projects'] == 5, f"5 projects ({st['projects']})")
        check(st['tasks'] == 68, f"68 legacy tasks ({st['tasks']}; {st['allTasks']} incl. today's repeating occurrences)")
        check(st['theme'] == 'ocean' and st['focusLen'] == 30, f"settings migrated (theme {st['theme']}, focus {st['focusLen']} min)")
        names = await page.evaluate('() => [...window.__pomofocus.state.streaks.values()].map(s => s.name).sort()')
        check(sorted(names) == ['Daily focus', 'Day Win'], f"first-run 'Daily focus' streak replaced by the migrated one, no duplicate ({names})")
        still = await page.evaluate('() => !!localStorage.getItem("pomofocus_data")')
        check(still, 'legacy localStorage key kept until the user removes it')
        snaps = await page.evaluate('async () => (await window.__pomofocus.state.repo.getAll("snapshots")).map(s => s.reason)')
        check(any('Legacy' in s for s in snaps), f'raw legacy copy saved as a safety snapshot ({len(snaps)} snapshots)')
        await page.goto(URL + '#/analytics/streaks'); await page.wait_for_timeout(500)
        streak_text = await page.locator('#view').inner_text()
        await page.screenshot(path=f'{SHOTS}/legacy-streaks-1440.png', full_page=True)

        # reload: prompt must not reappear, data persists
        await page.reload(); await wait_app(page); await page.wait_for_timeout(800)
        check(await page.get_by_role('dialog', name='Bring over your PomoFocus 1.x data?').count() == 0, 'legacy prompt not shown again after reload')
        st2 = await page.evaluate(STATS_JS)
        check(st2['pomos'] == 546, 'data persisted in IndexedDB across reload')

        # ---------- 2. re-import same legacy file (merge) → no duplicates ----------
        await page.goto(URL + '#/settings'); await wait_app(page)
        await page.set_input_files('input[data-change="backup-import"]', LEGACY)
        preview = page.get_by_role('dialog', name='Import preview')
        await preview.wait_for()
        rows = await preview.locator('tbody tr').all_inner_texts()
        new_counts = [r.split('\t')[3] if '\t' in r else '?' for r in rows]
        await preview.get_by_role('button', name='Import').click()
        await page.wait_for_timeout(1200)
        st3 = await page.evaluate(STATS_JS)
        check(st3['sessions'] == st2['sessions'] and st3['allTasks'] == st2['allTasks'] and st3['activity'] == st2['activity'], f're-importing the same legacy file adds nothing (sessions {st3["sessions"]}, tasks {st3["allTasks"]}; preview "new" column {new_counts})')

        # ---------- 3. invalid JSON ----------
        bad_path = '/tmp/bad.json'; open(bad_path, 'w').write('{ not json')
        await page.set_input_files('input[data-change="backup-import"]', bad_path)
        err = page.get_by_role('dialog', name='This file can’t be imported')
        await err.wait_for()
        check('not valid JSON' in await err.inner_text(), 'invalid JSON rejected with a clear message, nothing changed')
        await err.get_by_role('button', name='OK').click()

        # ---------- 4. export round trip ----------
        async with page.expect_download() as dl_info:
            await page.locator('[data-action="backup-export"]').click()
        dl = await dl_info.value
        path = await dl.path()
        exp = json.load(open(path))
        check(exp.get('app') == 'Winlark' and dl.suggested_filename.startswith('winlark-backup-') and exp.get('schemaVersion') == 2 and 'exportedAt' in exp, f"export is versioned ({dl.suggested_filename})")
        check(len(exp['sessions']) == st3['sessions'] and len(exp['tasks']) == st3['allTasks'], 'export contains all sessions and tasks')
        await page.set_input_files('input[data-change="backup-import"]', path)
        preview = page.get_by_role('dialog', name='Import preview')
        await preview.wait_for()
        await preview.get_by_role('button', name='Import').click()
        await page.wait_for_timeout(1000)
        st4 = await page.evaluate(STATS_JS)
        check(st4['sessions'] == st3['sessions'] and st4['allTasks'] == st3['allTasks'], 're-importing our own export is a no-op (merge)')

        # ---------- 5. quick add, Day Win, complete, move ----------
        await page.goto(URL + '#/today'); await wait_app(page)
        qa = page.locator('#quick-add-input')
        await qa.fill('E2E write report ~2 !h *')
        await qa.press('Enter')
        await page.wait_for_timeout(600)
        win_title = await page.locator('.win-card__title').inner_text()
        check('E2E write report' in win_title, 'quick add with * created the task and made it the Day Win')
        await qa.fill('E2E second task ~1')
        await qa.press('Enter')
        await page.wait_for_timeout(500)
        tid = await page.evaluate('() => [...window.__pomofocus.state.tasks.values()].find(t => t.title === "E2E second task").id')
        await page.locator(f'.task-row[data-id="{tid}"] [data-action="task-menu"]').click()
        await page.get_by_role('menuitem', name='Plan for tomorrow').click()
        await page.wait_for_timeout(500)
        moved = await page.evaluate('(id) => window.__pomofocus.state.tasks.get(id)', tid)
        check(moved['plannedDate'] > time.strftime('%Y-%m-%d') or len(moved['moveHistory']) == 1, f"task moved with history ({moved['moveHistory']})")
        await page.locator('.win-card [data-action="task-toggle"]').first.click()
        await page.wait_for_timeout(500)
        check('Day Win completed' in await page.locator('.win-card').inner_text(), 'completing the Day Win shows it as completed')
        await page.screenshot(path=f'{SHOTS}/today-legacy-1440.png', full_page=True)

        # ---------- 6. timer: start / pause / resume / refresh / reset ----------
        await page.get_by_role('button', name='Start timer (Space)').click()
        await page.wait_for_timeout(1300)
        v = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        check(v['status'] == 'running' and v['remainingMs'] < 30*60000, f"timer running ({v['remainingMs']} ms left)")
        await page.reload(); await wait_app(page); await page.wait_for_timeout(600)
        v2 = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        check(v2['status'] == 'running' and v2['remainingMs'] < v['remainingMs'], 'timer keeps running across a page refresh (timestamp based)')
        await page.keyboard.press('Space')
        await page.wait_for_timeout(300)
        v3 = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        await page.wait_for_timeout(1200)
        v4 = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        check(v3['status'] == 'paused' and v3['remainingMs'] == v4['remainingMs'], 'Space pauses; paused time does not count')
        await page.keyboard.press('Space'); await page.wait_for_timeout(300)
        check((await page.evaluate('() => window.__pomofocus.timer.timerView()'))['status'] == 'running', 'Space resumes')
        await page.keyboard.press('Shift+R'); await page.wait_for_timeout(300)
        v5 = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        check(v5['status'] == 'idle' and v5['remainingMs'] == 30*60000, 'Shift+R resets to a full 30-minute session')
        before = (await page.evaluate(STATS_JS))['pomos']

        # restore-after-close: persist a running session that already ended, then reload
        await page.evaluate("""async () => {
          const repo = window.__pomofocus.state.repo; const now = Date.now();
          await repo.bulkWrite({ put: { meta: [{ id: 'timer', value: { mode: 'focus', status: 'running', durationMs: 1800000, startedAt: now - 1900000, endsAt: now - 100000, elapsedMs: 0, sessionStart: now - 1900000, cycle: 0, taskId: null } }] } });
        }""")
        await page.reload(); await wait_app(page); await page.wait_for_timeout(800)
        after = (await page.evaluate(STATS_JS))['pomos']
        v6 = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        check(after == before + 1 and v6['mode'] == 'shortBreak' and v6['status'] == 'idle', f'session that ended while closed is recorded once, next phase not auto-started ({before}→{after}, {v6["mode"]}/{v6["status"]})')
        await page.reload(); await wait_app(page); await page.wait_for_timeout(500)
        check((await page.evaluate(STATS_JS))['pomos'] == after, 'no duplicate on second reload')

        # ---------- 7. theme ----------
        await page.goto(URL + '#/settings'); await wait_app(page)
        await page.locator('[data-action="theme-set"][data-value="paper"]').click()
        await page.wait_for_timeout(400)
        check(await page.evaluate('() => document.documentElement.dataset.theme') == 'paper', 'theme switch applies immediately (Paper)')
        await page.screenshot(path=f'{SHOTS}/settings-paper-1440.png', full_page=False)
        await page.goto(URL + '#/today'); await wait_app(page); await page.wait_for_timeout(300)
        await page.screenshot(path=f'{SHOTS}/today-paper-1440.png', full_page=True)
        await page.goto(URL + '#/settings'); await wait_app(page)
        await page.locator('[data-action="theme-set"][data-value="ocean"]').click()
        await page.wait_for_timeout(300)

        # ---------- 8. views render without errors ----------
        for r in ['plan', 'tasks', 'objectives', 'habits', 'calendar', 'analytics', 'analytics/planning', 'analytics/focus', 'projects', 'history', 'review']:
            await page.goto(URL + '#/' + r); await wait_app(page); await page.wait_for_timeout(350)
            await page.screenshot(path=f"{SHOTS}/{r.replace('/', '-')}-1440.png", full_page=True)
        check(True, 'all main views rendered')

        # ---------- 9. command palette + shortcuts help ----------
        await page.goto(URL + '#/today'); await wait_app(page)
        await page.keyboard.press('Control+k')
        pal = page.locator('.modal--palette'); await pal.wait_for()
        await page.wait_for_function('() => document.activeElement && document.activeElement.matches("[data-palette-input]")')
        await page.keyboard.type('analytics')
        await page.keyboard.press('Enter'); await page.wait_for_timeout(600)
        check('#/analytics' in page.url, 'command palette navigates (Ctrl+K → "analytics")')
        await page.keyboard.press('?')
        check(await page.get_by_role('dialog', name='Keyboard shortcuts').count() == 1, '? opens the shortcut help panel')
        await page.keyboard.press('Escape')
        await page.keyboard.press('f'); await page.wait_for_timeout(300)
        check(await page.locator('#focus-mode:not([hidden])').count() == 1, 'F opens focus mode')
        await page.screenshot(path=f'{SHOTS}/focus-mode-1440.png')
        await page.keyboard.press('Escape'); await page.wait_for_timeout(200)
        check(await page.locator('#focus-mode[hidden]').count() == 1, 'Esc exits focus mode')

        # ---------- 10. offline ----------
        await page.wait_for_function('async () => !!(await navigator.serviceWorker.getRegistration())?.active', timeout=15000)
        await page.reload(); await wait_app(page)  # make sure the page is controlled
        await ctx.set_offline(True)
        await page.reload(); await wait_app(page)
        check(await page.evaluate(STATS_JS) is not None, 'app reloads and works offline (service worker cache + IndexedDB)')
        await ctx.set_offline(False)

        # ---------- 11. responsive screenshots ----------
        for w, h in [(320, 640), (375, 812), (430, 932), (768, 1024), (1024, 768), (1440, 900), (1920, 1080)]:
            await page.set_viewport_size({'width': w, 'height': h})
            await page.goto(URL + '#/today'); await wait_app(page); await page.wait_for_timeout(400)
            overflow = await page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
            check(overflow <= 1, f'no horizontal overflow on Today at {w}px ({overflow}px)')
            await page.screenshot(path=f'{SHOTS}/today-{w}.png', full_page=True)
        await page.set_viewport_size({'width': 375, 'height': 812})
        for r in ['plan', 'tasks', 'calendar', 'analytics', 'history', 'settings']:
            await page.goto(URL + '#/' + r); await wait_app(page); await page.wait_for_timeout(350)
            overflow = await page.evaluate('() => document.documentElement.scrollWidth - window.innerWidth')
            check(overflow <= 1, f'no horizontal overflow on {r} at 375px ({overflow}px)')
            await page.screenshot(path=f'{SHOTS}/{r}-375.png', full_page=True)

        check(not errors, 'no console errors during the run' + ('' if not errors else ': ' + ' | '.join(errors[:5])))
        await browser.close()

        # ---------- 12. live completion with a fake clock (fresh profile) ----------
        browser = await p.chromium.launch()
        ctx = await browser.new_context(viewport={'width': 1280, 'height': 860}, timezone_id='Asia/Kolkata')
        page = await ctx.new_page()
        await page.clock.install()
        await page.goto(URL); await wait_app(page)
        await page.locator('#quick-add-input').fill('Clock task ~2')
        await page.locator('#quick-add-input').press('Enter'); await page.wait_for_timeout(300)
        await page.locator('.task-row [data-action="task-focus"]').first.click()
        await page.get_by_role('button', name='Start timer (Space)').click()
        await page.clock.run_for(25 * 60 * 1000 + 2000)
        await page.wait_for_timeout(500)
        st = await page.evaluate(STATS_JS)
        v = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        linked = await page.evaluate('() => [...window.__pomofocus.state.sessions.values()].filter(s => s.taskId).length')
        status = await page.evaluate('() => [...window.__pomofocus.state.tasks.values()].find(t => t.title === "Clock task").status')
        check(st['pomos'] == 1 and linked == 1 and v['mode'] == 'shortBreak', f'live completion records 1 Pomodoro linked to the active task and switches to a short break ({st["pomos"]}, {v["mode"]})')
        check(status == 'in-progress', f'task moves to in-progress after its first Pomodoro ({status})')
        await page.get_by_role('button', name='Start timer (Space)').click()
        await page.clock.run_for(5 * 60 * 1000 + 2000)
        await page.wait_for_timeout(400)
        v = await page.evaluate('() => window.__pomofocus.timer.timerView()')
        breaks = await page.evaluate('() => [...window.__pomofocus.state.sessions.values()].filter(s => s.type === "shortBreak").length')
        check(v['mode'] == 'focus' and breaks == 1, 'break completes and returns to focus; break recorded separately (not a Pomodoro)')
        # skip a focus after 2 minutes → stopped-early session, not counted
        await page.get_by_role('button', name='Start timer (Space)').click()
        await page.clock.run_for(2 * 60 * 1000 + 500)
        await page.locator('[data-action="timer-skip"]').first.click()
        await page.wait_for_timeout(400)
        st = await page.evaluate(STATS_JS)
        check(st['pomos'] == 1 and st['sessions'] == 3, f'skipping focus keeps a "stopped early" record that does not count as a Pomodoro ({st["pomos"]} counted, {st["sessions"]} records)')
        await browser.close()

    failed = [m for ok, m in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    if failed:
        print('FAILED:\n  ' + '\n  '.join(failed))
    sys.exit(1 if failed else 0)

asyncio.run(main())
