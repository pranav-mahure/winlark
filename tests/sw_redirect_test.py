"""Reproduce the reported error: serve-like server + current service worker.
Regression test for the "redirected response used for a navigation" bug.
Usage (from the project root): python3 tests/sw_redirect_test.py ."""
import asyncio, subprocess, sys, time, json, os
from playwright.async_api import async_playwright
root = sys.argv[1] if len(sys.argv) > 1 else '.'; label = sys.argv[2] if len(sys.argv) > 2 else ''
srv = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'serve_like.py'), root, '3000'], stdout=subprocess.DEVNULL, stderr=open('/tmp/serve3000.log', 'w'))
time.sleep(0.8)
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context()
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'[page {m.type}] {m.text}'))
        ctx.on('serviceworker', lambda w: logs.append('[sw registered] ' + w.url))
        # 1st visit: no SW yet
        r = await page.goto('http://localhost:3000/')
        await page.wait_for_timeout(2500)
        dbs = await page.evaluate('indexedDB.databases ? indexedDB.databases().then(d => d.map(x => x.name + "@" + x.version)) : "n/a"')
        ctrl = await page.evaluate('!!navigator.serviceWorker.controller')
        print(f'visit 1: status={r.status} booted={await page.evaluate("!!window.__pomofocus")} controlled={ctrl} dbs={dbs}')
        cached = await page.evaluate('''async () => { const out = []; for (const k of await caches.keys()) { const c = await caches.open(k); for (const name of ['./', './index.html']) { const res = await c.match(new URL(name, location).href); out.push([k, name, res ? {status: res.status, redirected: res.redirected, url: res.url} : null]); } } return out; }''')
        print('cache entries:', json.dumps(cached))
        # 2nd visit: page now controlled by the SW
        ok_visits = 0
        for i in (2, 3):
            try:
                r = await page.goto('http://localhost:3000/', wait_until='load', timeout=8000)
                await page.wait_for_timeout(1500)
                booted = await page.evaluate("!!window.__pomofocus"); ok_visits += booted
                print(f'visit {i}: status={r.status if r else None} url={page.url} booted={booted}')
            except Exception as e:
                print(f'visit {i}: NAVIGATION FAILED -> {str(e).splitlines()[0]}')
        await page.wait_for_timeout(500)
        print('\n'.join(l for l in logs if 'error' in l.lower() or 'sw' in l.lower() or 'Winlark' in l)[:3000])
        await b.close()
        bad = any(c[2] and c[2]['redirected'] for c in cached)
        print('RESULT:', 'PASS' if ok_visits == 2 and not bad else 'FAIL', '(controlled reloads work, no redirected responses cached)')
try:
    asyncio.run(main())
finally:
    srv.kill()
print('server log (first 12):'); print(''.join(open('/tmp/serve3000.log').readlines()[:12]))
