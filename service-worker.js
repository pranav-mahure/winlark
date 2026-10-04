/**
 * Winlark service worker — offline app shell.
 *
 * Strategy: every file of the app is precached into a versioned cache on
 * install and served cache-first, so the app opens with no network at all.
 * User data is never cached here; it lives in IndexedDB.
 *
 * Updating: bump CACHE_VERSION whenever any file changes. The new worker
 * installs in the background, the page shows "A new version is ready", and
 * the update applies when the user accepts (SKIP_WAITING) — never mid-session.
 *
 * Redirects: some static servers redirect file URLs. `npx serve` (cleanUrls,
 * on by default) answers /index.html with "301 → /". A Response produced by
 * following a redirect has `redirected === true`, and Chrome refuses to use
 * such a response for a navigation request (redirect mode "manual"):
 *   "a redirected response was used for a request whose redirect mode is not 'follow'".
 * So every response is stored *clean* (re-wrapped, without the redirected
 * flag), and cached responses are checked again before answering a navigation.
 */
// The cache name keeps the original 'pomofocus-' prefix on purpose: older installs' caches are cleaned up by that prefix.
const CACHE_VERSION = 'pomofocus-v2.0.0-4';
// Diagnostics: on for localhost/127.0.0.1 only (development), silent in production.
const DEBUG = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const log = (...a) => { if (DEBUG) console.info('[Winlark SW]', ...a); };
const SHELL = [
    './',
    './index.html',
    './manifest.json',
    './assets/fonts/OFL.txt',
    './assets/fonts/lora-variable.woff',
    './assets/icons/apple-touch-icon.png',
    './assets/icons/icon-192.png',
    './assets/icons/icon-512.png',
    './assets/icons/icon-maskable-512.png',
    './assets/icons/icon.svg',
    './css/base.css',
    './css/components.css',
    './css/layout.css',
    './css/reset.css',
    './css/responsive.css',
    './css/themes.css',
    './css/variables.css',
    './css/views.css',
    './js/app.js',
    './js/core/constants.js',
    './js/core/events.js',
    './js/core/state.js',
    './js/features/analytics.js',
    './js/features/audio.js',
    './js/features/calendar.js',
    './js/features/daily-plan.js',
    './js/features/habits.js',
    './js/features/insights.js',
    './js/features/notifications.js',
    './js/features/objectives.js',
    './js/features/projects.js',
    './js/features/review.js',
    './js/features/sessions.js',
    './js/features/settings.js',
    './js/features/streaks.js',
    './js/features/tasks.js',
    './js/features/timer.js',
    './js/storage/backup.js',
    './js/storage/db.js',
    './js/storage/migration.js',
    './js/storage/repository.js',
    './js/ui/actions.js',
    './js/ui/charts.js',
    './js/ui/command.js',
    './js/ui/components.js',
    './js/ui/dnd.js',
    './js/ui/focus-mode.js',
    './js/ui/handlers.js',
    './js/ui/icons.js',
    './js/ui/modals.js',
    './js/ui/render.js',
    './js/ui/router.js',
    './js/ui/task-dialogs.js',
    './js/ui/timer-ui.js',
    './js/ui/toast.js',
    './js/utils/dates.js',
    './js/utils/dom.js',
    './js/utils/format.js',
    './js/utils/ids.js',
    './js/utils/validation.js',
    './js/views/analytics.js',
    './js/views/calendar.js',
    './js/views/habits.js',
    './js/views/history.js',
    './js/views/objectives.js',
    './js/views/plan.js',
    './js/views/projects.js',
    './js/views/review.js',
    './js/views/settings.js',
    './js/views/tasks.js',
    './js/views/today.js',
];

/** Copy of a response without the `redirected` flag (same body, status and headers). */
async function cleanResponse(res) {
  if (!res || !res.redirected) return res;
  const body = await res.blob();
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
}

/** Precache every shell file; fails the install (like cache.addAll) if any file is missing. */
async function precache() {
  const cache = await caches.open(CACHE_VERSION);
  const entries = await Promise.all(SHELL.map(async (path) => {
    const url = new URL(path, self.registration.scope).href;
    const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
    if (!res.ok) throw new Error(`Precache failed for ${path}: HTTP ${res.status}`);
    if (res.redirected) log(`precache: ${path} was redirected to ${res.url}; storing a clean copy`);
    return [url, await cleanResponse(res)];
  }));
  await Promise.all(entries.map(([url, res]) => cache.put(url, res)));
  log(`installed ${CACHE_VERSION} (${entries.length} files)`);
}

self.addEventListener('install', (event) => {
  log('install', CACHE_VERSION);
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    // Only this app's own file caches are removed (old versions). User data lives in IndexedDB and is never touched here.
    const old = keys.filter((k) => k.startsWith('pomofocus-') && k !== CACHE_VERSION);
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
    log('activated', CACHE_VERSION, old.length ? `(removed old app caches: ${old.join(', ')})` : '');
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Any navigation inside the app scope gets the cached shell (hash routing does the rest).
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const scope = self.registration.scope;
      const cached = (await cache.match(scope)) || (await cache.match(new URL('index.html', scope).href));
      if (cached) {
        log('navigation', url.pathname, '→ cached shell', cached.redirected ? '(cleaned redirected entry)' : '');
        return cleanResponse(cached);
      }
      log('navigation', url.pathname, '→ network (shell not cached yet)');
      try {
        // fetch(event.request) keeps redirect mode "manual"; the browser itself
        // follows any redirect, which is valid for a navigation.
        return await fetch(req);
      } catch {
        return new Response('Winlark is offline and not cached yet.', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, (await cleanResponse(res.clone())));
      return res;
    } catch (err) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = all.find((c) => c.url.startsWith(self.registration.scope));
    if (client) return client.focus();
    return self.clients.openWindow('./#/today');
  })());
});
