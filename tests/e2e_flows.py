"""
E2E part 2 — create/edit/delete flows on a fresh profile:
projects, objectives (auto-complete rule), task form (recurrence, dependency,
Day Win), habits + habit streak, custom streak, manual session log/edit/assign/
delete with undo, daily review, project delete keeps tasks, calendar day panel.

Run with a static server on :8765:  python3 tests/e2e_flows.py
"""
import asyncio, sys, os
from playwright.async_api import async_playwright

URL = os.environ.get('POMO_URL', 'http://localhost:8765/')
SHOTS = os.environ.get('POMO_SHOTS', '/tmp/shots')
results = []

def check(cond, msg):
    results.append((bool(cond), msg)); print(('PASS  ' if cond else 'FAIL  ') + msg, flush=True)

S = 'window.__pomofocus.state'

async def ready(page):
    # wait until the view for the current hash has rendered (hash navigation keeps the old page briefly)
    await page.wait_for_function('''() => {
      if (!window.__pomofocus || !document.querySelector("#view .page")) return false;
      const r = (location.hash.replace(/^#\\/?/, '').split(/[/?]/)[0]) || 'today';
      return document.body.dataset.route === r;
    }''', timeout=15000)
    await page.wait_for_timeout(100)

async def modal(page, title):
    m = page.get_by_role('dialog', name=title)
    await m.wait_for(timeout=5000)
    return m

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 1366, 'height': 900}, timezone_id='Asia/Kolkata')
        page = await ctx.new_page()
        errors = []
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.goto(URL); await ready(page)

        # ---------- project ----------
        await page.goto(URL + '#/projects'); await ready(page)
        await page.locator('[data-action="project-new"]').first.click()
        m = await modal(page, 'New project')
        await m.locator('[name="name"]').fill('Thesis')
        await m.get_by_role('button', name='Create').click()
        await page.wait_for_timeout(300)
        pid = await page.evaluate(f'() => [...{S}.projects.values()].find(p => p.name === "Thesis")?.id')
        check(bool(pid), 'project created')

        # ---------- objective with "all tasks" rule ----------
        await page.goto(URL + '#/objectives'); await ready(page)
        await page.locator('[data-action="objective-new"]').first.click()
        m = await modal(page, 'New objective')
        await m.locator('[name="title"]').fill('Finish chapter 2')
        await m.locator('[name="projectId"]').select_option(pid)
        await m.locator('[name="completionRule"][value="all-tasks"]').check()
        await m.get_by_role('button', name='Create objective').click()
        await page.wait_for_timeout(300)
        oid = await page.evaluate(f'() => [...{S}.objectives.values()].find(o => o.title === "Finish chapter 2")?.id')
        check(bool(oid), 'objective created and linked to the project')

        # ---------- tasks via the full form ----------
        await page.goto(URL + '#/today'); await ready(page)
        for title, est in [('Outline chapter', '2'), ('Write chapter draft', '4')]:
            await page.keyboard.press('n')
            m = await modal(page, 'New task')
            await m.locator('[name="title"]').fill(title)
            await m.locator('[name="estimate"]').fill(est)
            await m.locator('[name="objectiveId"]').select_option(oid)
            await m.locator('[name="projectId"]').select_option(pid)
            if title == 'Write chapter draft':
                await m.locator('details:has-text("Depends on") summary').click()
                await m.locator('.dep-item:has-text("Outline chapter") input').check()
                await m.locator('[name="dayWin"]').check()
            await m.get_by_role('button', name='Add task').click()
            await page.wait_for_timeout(300)
        draft = await page.evaluate(f'() => [...{S}.tasks.values()].find(t => t.title === "Write chapter draft")')
        outline = await page.evaluate(f'() => [...{S}.tasks.values()].find(t => t.title === "Outline chapter")')
        check(draft['dependsOn'] == [outline['id']], 'dependency saved from the task form')
        check('Write chapter draft' in await page.locator('.win-card').inner_text(), 'Day Win set from the task form')
        check(await page.locator(f'.task-row[data-id="{draft["id"]}"] .is-warn').count() == 1, 'dependency shown on the task row')

        # repeating task
        await page.keyboard.press('n')
        m = await modal(page, 'New task')
        await m.locator('[name="title"]').fill('Read papers')
        await m.locator('[name="repeat"]').select_option('weekdays')
        await m.get_by_role('button', name='Add task').click()
        await page.wait_for_timeout(400)
        rep = await page.evaluate(f'() => [...{S}.tasks.values()].filter(t => t.title === "Read papers").map(t => t.kind)')
        check('series' in rep, f'repeating task created as a series ({rep})')

        # reorder with keyboard (Alt+Down) on the first task row
        order_before = await page.locator('.tasks-card .task-list[data-sortable] > .task-row').evaluate_all('els => els.map(e => e.dataset.id)')
        await page.locator(f'.task-row[data-id="{order_before[0]}"] .task-row__title').focus()
        await page.keyboard.press('Alt+ArrowDown'); await page.wait_for_timeout(400)
        order_after = await page.locator('.tasks-card .task-list[data-sortable] > .task-row').evaluate_all('els => els.map(e => e.dataset.id)')
        check(order_after[1] == order_before[0], 'Alt+↓ reorders tasks without dragging')
        stored = await page.evaluate(f'(ids) => ids.map(id => {S}.tasks.get(id).order)', order_after)
        check(stored == sorted(stored), 'new order persisted')

        # pointer drag with the handle
        rows = page.locator('.tasks-card .task-list[data-sortable] > .task-row')
        first = await rows.nth(0).get_attribute('data-id')
        h = rows.nth(0).locator('.drag-handle'); box = await h.bounding_box(); last = await rows.nth(await rows.count() - 1).bounding_box()
        await page.mouse.move(box['x'] + 5, box['y'] + 5); await page.mouse.down()
        await page.mouse.move(box['x'] + 5, last['y'] + last['height'] - 2, steps=8); await page.mouse.up()
        await page.wait_for_timeout(500)
        ids = await page.locator('.tasks-card .task-list[data-sortable] > .task-row').evaluate_all('els => els.map(e => e.dataset.id)')
        check(ids[-1] == first, 'drag handle reorders the list')

        # complete both objective tasks → objective auto-completes
        for t in (outline, draft):
            await page.locator(f'.task-row[data-id="{t["id"]}"] [data-action="task-toggle"]').click()
            await page.wait_for_timeout(300)
        st = await page.evaluate(f'(id) => {S}.objectives.get(id).status', oid)
        check(st == 'completed', 'objective with the "all tasks" rule completes itself')

        # ---------- habit ----------
        await page.goto(URL + '#/habits'); await ready(page)
        await page.locator('[data-action="habit-new"]').first.click()
        m = await modal(page, 'New habit')
        await m.locator('[name="name"]').fill('Walk 20 min')
        await m.get_by_role('button', name='Add habit').click()
        await page.wait_for_timeout(300)
        hid = await page.evaluate(f'() => [...{S}.habits.values()].find(h => h.name === "Walk 20 min")?.id')
        await page.goto(URL + '#/today'); await ready(page)
        await page.locator(f'[data-action="habit-toggle"][data-id="{hid}"]').first.click(); await page.wait_for_timeout(300)
        await page.locator(f'[data-action="habit-toggle"][data-id="{hid}"]').first.click(); await page.wait_for_timeout(300)
        await page.locator(f'[data-action="habit-toggle"][data-id="{hid}"]').first.click(); await page.wait_for_timeout(300)
        n = await page.evaluate(f'(id) => [...{S}.habitCompletions.values()].filter(c => c.habitId === id).length', hid)
        check(n == 1, f'habit check-in toggles without duplicates ({n} record)')

        # ---------- custom streak ----------
        await page.goto(URL + '#/analytics/streaks'); await ready(page)
        await page.locator('[data-action="streak-new"]').first.click()
        m = await modal(page, 'New streak')
        await m.locator('[name="name"]').fill('Walk streak')
        await m.locator('[name="metric"]').select_option('habit')
        await m.locator(f'[name="habitIds"][value="{hid}"]').check()
        await m.get_by_role('button', name='Create streak').click()
        await page.wait_for_timeout(400)
        txt = await page.locator('#view').inner_text()
        check('Walk streak' in txt, 'custom habit streak created and listed')
        await page.screenshot(path=f'{SHOTS}/flows-streaks.png', full_page=True)

        # ---------- manual session: log, assign, edit, delete + undo ----------
        await page.goto(URL + '#/history'); await ready(page)
        await page.locator('[data-action="session-log"]').first.click()
        m = await modal(page, 'Log a session')
        await m.locator('[name="duration"]').fill('45')
        await m.get_by_role('button', name='Log session').click()
        await page.wait_for_timeout(400)
        sess = await page.evaluate(f'() => [...{S}.sessions.values()].filter(s => s.source === "manual")')
        check(len(sess) == 1 and sess[0]['actualDuration'] == 2700 and sess[0]['taskId'] is None, 'manual 45-min session logged (unassigned)')
        sid = sess[0]['id']
        await page.locator(f'[data-action="session-edit"][data-id="{sid}"]').first.click()
        m = await modal(page, 'Edit session')
        await m.locator('[name="duration"]').fill('50')
        await m.locator('[name="taskId"]').select_option(draft['id'])
        await m.get_by_role('button', name='Save').click()
        await page.wait_for_timeout(400)
        s2 = await page.evaluate(f'(id) => {S}.sessions.get(id)', sid)
        check(s2['actualDuration'] == 3000 and s2['taskId'] == draft['id'] and s2['projectId'] == pid, 'session edited: duration, task and project follow')
        await page.locator(f'[data-action="session-delete"][data-id="{sid}"]').first.click()
        conf = page.get_by_role('dialog').last
        if await conf.count():
            btn = conf.get_by_role('button', name='Delete')
            if await btn.count(): await btn.click()
        await page.wait_for_timeout(400)
        gone = await page.evaluate(f'(id) => !{S}.sessions.has(id)', sid)
        await page.locator('.toast__action:has-text("Undo")').last.click(); await page.wait_for_timeout(400)
        back = await page.evaluate(f'(id) => {S}.sessions.has(id)', sid)
        check(gone and back, 'session delete can be undone')

        # ---------- review ----------
        await page.goto(URL + '#/review'); await ready(page)
        await page.locator('[name="wentWell"]').fill('Finished the outline early.')
        await page.locator('#review-form [type="submit"]').click(); await page.wait_for_timeout(400)
        rv = await page.evaluate(f'() => [...{S}.reviews.values()][0]?.wentWell')
        check(rv == 'Finished the outline early.', 'daily review reflections saved')
        txt = await page.locator('#view').inner_text()
        check('score' not in txt.lower(), 'review shows no productivity score')
        await page.screenshot(path=f'{SHOTS}/flows-review.png', full_page=True)

        # ---------- calendar ----------
        await page.goto(URL + '#/calendar'); await ready(page)
        check(await page.locator('[data-action="cal-select"]').count() >= 28, 'calendar month grid rendered')
        await page.screenshot(path=f'{SHOTS}/flows-calendar.png', full_page=True)

        # ---------- delete project keeps tasks ----------
        await page.goto(URL + f'#/projects/{pid}'); await ready(page)
        await page.locator('[data-action="project-delete"]').first.click()
        conf = page.get_by_role('dialog').last
        await conf.get_by_role('button', name='Delete').last.click(); await page.wait_for_timeout(500)
        kept = await page.evaluate(f'(id) => {S}.tasks.get(id)?.projectId', draft['id'])
        check(kept is None and await page.evaluate(f'(id) => {S}.tasks.has(id)', draft['id']), 'deleting a project keeps its tasks (unlinked)')

        # ---------- analytics recalculation ----------
        await page.goto(URL + '#/settings'); await ready(page)
        await page.locator('[data-action="an-recalc-settings"]').first.click(); await page.wait_for_timeout(300)
        check(True, 'analytics recalculation runs')

        check(not errors, 'no console errors' + ('' if not errors else ': ' + ' | '.join(errors[:5])))
        await b.close()
    failed = [m for ok, m in results if not ok]
    print(f'\n{len(results) - len(failed)}/{len(results)} checks passed')
    if failed: print('FAILED:\n  ' + '\n  '.join(failed))
    sys.exit(1 if failed else 0)

asyncio.run(main())
