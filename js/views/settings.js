/** Settings — timer, sound, appearance, goals, data, application, shortcuts. */
import { state, clearDerivedCaches } from '../core/state.js';
import { esc, qs, readFileText, downloadFile } from '../utils/dom.js';
import { fmtBytes, fmtDateTime, fmtDuration, plural } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { toggle, options, sectionHead } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, errorToast } from '../ui/toast.js';
import { navigate } from '../ui/router.js';
import { THEMES, ALARMS, AMBIENTS, APP_VERSION, DATA_SCHEMA_VERSION, DATA_COLLECTIONS } from '../core/constants.js';
import { updateSettings, focusTargetMinutes } from '../features/settings.js';
import { notificationStatus, requestPermission, STATUS_TEXT } from '../features/notifications.js';
import { playAlarm, unlockAudio } from '../features/audio.js';
import {
  downloadBackup, parseBackupText, parseBackupObject, previewImport, applyImport, listSnapshots, getSnapshotPayload,
  deleteSnapshot, restoreSnapshot, resetAllData, estimateStorage, createSnapshot,
} from '../storage/backup.js';
import { readLegacyLocalStorage, removeLegacyLocalStorage } from '../storage/migration.js';
import { SHORTCUTS } from '../ui/command.js';
import { emit } from '../core/events.js';

export const title = 'Settings';
const SECTIONS = [['timer', 'Timer'], ['goals', 'Daily goals'], ['notifications', 'Notifications'], ['sound', 'Sound'], ['ambient', 'Ambient'], ['appearance', 'Appearance'], ['streaks', 'Streaks'], ['data', 'Data & backup'], ['application', 'Application'], ['shortcuts', 'Shortcuts']];

const num = (group, key, label, { min, max, unit = 'min', hint = '', value }) => `<div class="setting-row"><label for="set-${group}-${key}"><span class="setting-row__label">${esc(label)}</span>${hint ? `<span class="setting-row__hint">${hint}</span>` : ''}</label>
  <span class="input-suffix"><input id="set-${group}-${key}" type="number" class="input input--narrow" min="${min}" max="${max}" value="${value ?? ''}" data-change="setting" data-group="${group}" data-key="${key}" data-type="int">${unit ? `<span>${esc(unit)}</span>` : ''}</span></div>`;

const sel = (group, key, label, opts, value, hint = '') => `<div class="setting-row"><label for="set-${group}-${key}"><span class="setting-row__label">${esc(label)}</span>${hint ? `<span class="setting-row__hint">${hint}</span>` : ''}</label>
  <select id="set-${group}-${key}" class="input input--small" data-change="setting" data-group="${group}" data-key="${key}">${options(opts, value)}</select></div>`;

const range = (group, key, label, value) => `<div class="setting-row"><label for="set-${group}-${key}"><span class="setting-row__label">${esc(label)}</span></label>
  <span class="range-wrap"><input id="set-${group}-${key}" type="range" min="0" max="100" value="${value}" data-change="setting" data-group="${group}" data-key="${key}" data-type="int" aria-valuetext="${value}%"><output>${value}%</output></span></div>`;

const sw = (group, key, label, checked, hint = '') => toggle({ name: `${group}.${key}`, checked, label, hint, action: 'setting', data: { 'data-group': group, 'data-key': key, 'data-type': 'bool', id: `set-${group}-${key}` } });

function dataSection() {
  const legacy = readLegacyLocalStorage();
  return `<section class="card settings-section" id="sec-data" aria-labelledby="h-data"><h2 id="h-data" class="section-title">${icon('database', { size: 18 })}Data &amp; backup</h2>
    <p class="muted">Everything is stored on this device in your browser (IndexedDB). Nothing is uploaded. Export a backup regularly, especially before clearing browser data.</p>
    <div class="setting-actions">
      <button type="button" class="btn btn--primary" data-action="backup-export">${icon('download', { size: 15 })}Export backup (JSON)</button>
      <label class="btn btn--secondary file-btn">${icon('upload', { size: 15 })}Import a backup…<input type="file" accept="application/json,.json" data-change="backup-import" class="sr-only"></label>
    </div>
    <p class="muted small">Import accepts Winlark backups and PomoFocus 1.x exports. You’ll see a preview and choose to merge or replace before anything changes; a safety copy is made first.</p>
    ${legacy.found ? `<div class="notice notice--legacy">${icon('info', { size: 16 })}<div><strong>Data from PomoFocus 1.x was found in this browser.</strong>
      <p>${legacy.valid ? 'You can import it into 2.0. The old copy is left untouched until you remove it.' : esc(legacy.error)}</p>
      <div class="setting-actions">${legacy.valid ? '<button type="button" class="btn btn--small btn--primary" data-action="legacy-import">Review and import</button>' : ''}
        <button type="button" class="btn btn--small btn--ghost" data-action="legacy-download">Download the old data</button>
        <button type="button" class="btn btn--small btn--ghost" data-action="legacy-remove">Remove old data…</button></div></div></div>` : ''}
    <h3 class="sub-title">Safety copies</h3>
    <p class="muted small">Made automatically before every import, restore and reset (the 8 most recent are kept; copies of 1.x data are kept until you delete them).</p>
    <div data-snapshots><p class="muted small">Loading…</p></div>
    <div class="setting-actions"><button type="button" class="btn btn--small btn--ghost" data-action="snapshot-create">${icon('plus', { size: 14 })}Make a safety copy now</button></div>
    <h3 class="sub-title">Maintenance</h3>
    <div class="setting-actions">
      <button type="button" class="btn btn--small btn--secondary" data-action="an-recalc-settings">${icon('reset', { size: 14 })}Recalculate analytics</button>
      <button type="button" class="btn btn--small btn--danger-ghost" data-action="data-reset">${icon('trash', { size: 14 })}Delete all data…</button>
    </div>
  </section>`;
}

export function render() {
  const s = state.settings;
  const notif = notificationStatus();
  return `<div class="page page--settings">
    <header class="page-head"><div><h1 class="page-title">Settings</h1></div></header>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="Settings sections">${SECTIONS.map(([k, l]) => `<a href="#sec-${k}" data-action="settings-jump" data-value="${k}">${esc(l)}</a>`).join('')}</nav>
      <div class="settings-body">
        <section class="card settings-section" id="sec-timer" aria-labelledby="h-timer"><h2 id="h-timer" class="section-title">${icon('timer', { size: 18 })}Timer</h2>
          ${num('timer', 'focusMin', 'Focus length', { min: 1, max: 180, value: s.timer.focusMin })}
          ${num('timer', 'shortMin', 'Short break', { min: 1, max: 120, value: s.timer.shortMin })}
          ${num('timer', 'longMin', 'Long break', { min: 1, max: 180, value: s.timer.longMin })}
          ${num('timer', 'longEvery', 'Long break after', { min: 1, max: 12, unit: 'Pomodoros', value: s.timer.longEvery })}
          ${sw('timer', 'autoStartBreak', 'Start breaks automatically', s.timer.autoStartBreak)}
          ${sw('timer', 'autoStartFocus', 'Start the next Pomodoro automatically after a break', s.timer.autoStartFocus)}
          <p class="muted small">Changes apply to the next session; a running session keeps its length.</p>
        </section>
        <section class="card settings-section" id="sec-goals" aria-labelledby="h-goals"><h2 id="h-goals" class="section-title">${icon('target', { size: 18 })}Daily goals &amp; workload</h2>
          ${num('goals', 'dailyPomos', 'Daily Pomodoro goal', { min: 0, max: 50, unit: 'Pomodoros', value: s.goals.dailyPomos, hint: '0 turns the goal off. Shown as the outer ring of the Focus Dial.' })}
          ${num('goals', 'focusTargetMin', 'Daily focus target', { min: 0, max: 1440, value: s.goals.focusTargetMin, hint: `Leave empty to use goal × focus length (currently ${fmtDuration(focusTargetMinutes(s))}). Used for workload.` })}
          ${num('goals', 'workloadLightPct', 'Light workload below', { min: 10, max: 200, unit: '% of target', value: s.goals.workloadLightPct })}
          ${num('goals', 'workloadHeavyPct', 'Heavy workload above', { min: 20, max: 400, unit: '% of target', value: s.goals.workloadHeavyPct })}
          ${sel('general', 'weekStart', 'Week starts on', [{ value: 1, label: 'Monday' }, { value: 0, label: 'Sunday' }, { value: 6, label: 'Saturday' }], s.general.weekStart)}
        </section>
        <section class="card settings-section" id="sec-notifications" aria-labelledby="h-notif"><h2 id="h-notif" class="section-title">${icon('bell', { size: 18 })}Notifications</h2>
          ${sw('notifications', 'enabled', 'Notify me when a session ends', s.notifications.enabled && notif === 'granted', esc(STATUS_TEXT[notif]))}
          ${notif === 'granted' ? '<button type="button" class="btn btn--small btn--ghost" data-action="notify-test">Send a test notification</button>' : ''}
        </section>
        <section class="card settings-section" id="sec-sound" aria-labelledby="h-sound"><h2 id="h-sound" class="section-title">${icon('volume', { size: 18 })}Sound</h2>
          <div class="setting-row"><label for="set-sound-alarm"><span class="setting-row__label">Completion sound</span></label><span class="inline-controls"><select id="set-sound-alarm" class="input input--small" data-change="setting" data-group="sound" data-key="alarm">${options(ALARMS.map((a) => ({ value: a.id, label: a.label })), s.sound.alarm)}</select><button type="button" class="btn btn--small btn--ghost" data-action="sound-test">${icon('play', { size: 13 })}Test</button></span></div>
          ${range('sound', 'volume', 'Volume', s.sound.volume)}
          ${sw('sound', 'tick', 'Ticking sound during focus', s.sound.tick)}
        </section>
        <section class="card settings-section" id="sec-ambient" aria-labelledby="h-amb"><h2 id="h-amb" class="section-title">${icon('headphones', { size: 18 })}Ambient sound</h2>
          <div class="ambient-pills" role="group" aria-label="Ambient sound"><button type="button" class="chip-btn${s.ambient.sound === 'none' ? ' is-on' : ''}" data-action="ambient-pick" data-value="none" aria-pressed="${s.ambient.sound === 'none'}">Off</button>${AMBIENTS.map((a) => `<button type="button" class="chip-btn${s.ambient.sound === a.id ? ' is-on' : ''}" data-action="ambient-pick" data-value="${a.id}" aria-pressed="${s.ambient.sound === a.id}">${esc(a.label)}</button>`).join('')}</div>
          ${range('ambient', 'volume', 'Ambient volume', s.ambient.volume)}
          ${sel('ambient', 'mode', 'Play', [{ value: 'focus', label: 'Only while a focus session runs' }, { value: 'always', label: 'Whenever it is switched on' }], s.ambient.mode)}
          <p class="muted small">All sounds are generated in your browser, so they work offline. Browsers only allow sound after you interact with the page.</p>
        </section>
        <section class="card settings-section" id="sec-appearance" aria-labelledby="h-app"><h2 id="h-app" class="section-title">${icon('palette', { size: 18 })}Appearance</h2>
          <div class="theme-grid" role="radiogroup" aria-label="Theme">${THEMES.map((t) => `<button type="button" role="radio" aria-checked="${s.appearance.theme === t.id}" class="theme-card${s.appearance.theme === t.id ? ' is-on' : ''}" data-action="theme-set" data-value="${t.id}" data-theme-preview="${t.id}">
            <span class="theme-card__preview"><span class="tp-surface"><span class="tp-dial"></span><span class="tp-lines"><span></span><span></span><span></span></span></span></span><span class="theme-card__name">${esc(t.name)}${s.appearance.theme === t.id ? ` ${icon('check', { size: 13 })}` : ''}</span></button>`).join('')}</div>
          ${sel('appearance', 'motion', 'Animations', [{ value: 'system', label: 'Follow system setting' }, { value: 'reduce', label: 'Reduce' }, { value: 'full', label: 'Full' }], s.appearance.motion)}
        </section>
        <section class="card settings-section" id="sec-streaks" aria-labelledby="h-str"><h2 id="h-str" class="section-title">${icon('flame', { size: 18 })}Streaks</h2>
          <p class="muted">${plural(state.streaks.size, 'streak')} configured. Create streaks for focus, tasks, objectives, the Day Win or habits, with your own thresholds and active days.</p>
          <a class="btn btn--secondary btn--small" href="#/analytics/streaks">Manage streaks</a>
        </section>
        ${dataSection()}
        <section class="card settings-section" id="sec-application" aria-labelledby="h-appl"><h2 id="h-appl" class="section-title">${icon('info', { size: 18 })}Application</h2>
          <dl class="facts">
            <div><dt>Version</dt><dd>Winlark ${APP_VERSION} (data format ${DATA_SCHEMA_VERSION})</dd></div>
            <div><dt>Storage</dt><dd>${state.persistent ? 'IndexedDB on this device' : '<strong>Temporary memory only</strong> — data will be lost when this tab closes. Export a backup.'}</dd></div>
            <div><dt>Records</dt><dd>${DATA_COLLECTIONS.map((c) => state[c].size).reduce((a, b) => a + b, 0).toLocaleString()} (${state.tasks.size} tasks, ${state.sessions.size} sessions)</dd></div>
            <div><dt>Space used</dt><dd data-storage-usage>—</dd></div>
            <div><dt>Offline</dt><dd data-sw-status>Checking…</dd></div>
          </dl>
          <div class="setting-actions"><button type="button" class="btn btn--small btn--secondary" data-action="storage-persist" data-persist-btn>Ask the browser to keep data permanently</button>
            <button type="button" class="btn btn--small btn--ghost" data-action="app-update-check">Check for updates</button></div>
        </section>
        <section class="card settings-section" id="sec-shortcuts" aria-labelledby="h-keys"><h2 id="h-keys" class="section-title">${icon('keyboard', { size: 18 })}Keyboard shortcuts</h2>
          <div class="shortcut-groups">${SHORTCUTS.map(([g, list]) => `<section><h3 class="shortcut-group__title">${esc(g)}</h3><dl class="shortcuts">${list.map(([k, d]) => `<div><dt>${k.split('  or  ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' or ')}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl></section>`).join('')}</div>
        </section>
      </div>
    </div>
  </div>`;
}

export async function mount(root) {
  // async details (snapshots, storage, service worker)
  try {
    const snaps = await listSnapshots();
    const box = qs('[data-snapshots]', root);
    if (box) {
      box.innerHTML = snaps.length ? `<ul class="snapshot-list">${snaps.map((s) => `<li><span><strong>${esc(s.reason)}</strong><span class="muted small">${esc(fmtDateTime(s.createdAt))}${s.counts ? `, ${s.counts.tasks} tasks, ${s.counts.sessions} sessions` : ''}, ${fmtBytes(s.size)}</span></span>
        <span class="snapshot-list__actions"><button type="button" class="btn btn--small btn--ghost" data-action="snapshot-download" data-id="${esc(s.id)}">${icon('download', { size: 13 })}Download</button>${s.reason.startsWith('Legacy') ? '' : `<button type="button" class="btn btn--small btn--secondary" data-action="snapshot-restore" data-id="${esc(s.id)}">Restore</button>`}<button type="button" class="icon-btn" data-action="snapshot-delete" data-id="${esc(s.id)}" aria-label="Delete safety copy">${icon('trash', { size: 14 })}</button></span></li>`).join('')}</ul>` : '<p class="muted small">No safety copies yet.</p>';
    }
  } catch (err) { console.warn(err); }
  const est = await estimateStorage();
  const u = qs('[data-storage-usage]', root);
  if (u && est) u.textContent = `${fmtBytes(est.usage)} of ${fmtBytes(est.quota)} available${est.persisted ? ', kept permanently' : ''}`;
  if (est?.persisted) { const b = qs('[data-persist-btn]', root); if (b) { b.disabled = true; b.textContent = 'Data is kept permanently'; } }
  const swEl = qs('[data-sw-status]', root);
  if (swEl) {
    if (!('serviceWorker' in navigator)) swEl.textContent = 'Not supported in this browser.';
    else {
      const reg = await navigator.serviceWorker.getRegistration();
      swEl.textContent = reg?.active ? 'Ready — the app works without a connection.' : location.protocol === 'file:' ? 'Unavailable when opened as a file. Serve the folder (e.g. npx serve .).' : 'Installing… reload once to finish.';
    }
  }
}

// ---------- import flow ----------
export function showImportPreview(parsed, { source = 'file', onDone } = {}) {
  const pv = previewImport(parsed.dataset);
  const rep = parsed.report;
  const rows = DATA_COLLECTIONS.filter((c) => pv.perStore[c].incoming || pv.perStore[c].local);
  const legacy = parsed.format === 'legacy-v1';
  const defaults = [...state.streaks.values()].filter((x) => x.id.startsWith('k_default') && x.updatedAt === x.createdAt).length;
  const userRecords = pv.localTotal - defaults;
  const body = `<p>${legacy ? `<strong>PomoFocus 1.x data</strong> — it will be converted to the 2.0 format.` : `<strong>Winlark backup</strong> (format ${esc(parsed.format)})${parsed.exportedAt ? `, exported ${esc(fmtDateTime(Date.parse(parsed.exportedAt)))}` : ''}.`}</p>
    ${rep ? `<div class="migration-report"><h3 class="sub-title">Conversion check</h3><ul class="check-list">${rep.checks.map((c) => `<li class="${c.ok ? 'is-ok' : 'is-bad'}">${icon(c.ok ? 'check' : 'info', { size: 14 })}${esc(c.label)} <span class="muted">${esc(c.detail || '')}</span></li>`).join('')}</ul>
      <p class="muted small">${rep.counts.taskSessions} Pomodoros linked to tasks, ${rep.counts.unassignedSessions} kept as unassigned (v1 counted them without a task). Imported sessions have dates but no times.</p>
      ${rep.notes.length ? `<ul class="plain-list small">${rep.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}</div>` : ''}
    <div class="table-scroll"><table class="data-table"><thead><tr><th scope="col">Data</th><th scope="col">In file</th><th scope="col">On this device</th><th scope="col">New</th><th scope="col">Newer in file</th><th scope="col">Same / older</th></tr></thead><tbody>
      ${rows.map((c) => { const s = pv.perStore[c]; return `<tr><th scope="row">${esc(c.replace(/([A-Z])/g, ' $1').toLowerCase())}</th><td>${s.incoming}</td><td>${s.local}</td><td>${s.add}</td><td>${s.update}</td><td>${s.same + s.keepLocal}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${parsed.warnings.length ? `<details class="warnings"><summary>${plural(parsed.warnings.length, 'note')} about this file</summary><ul class="plain-list small">${parsed.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></details>` : ''}
    <fieldset class="field"><legend class="field__label">How to import</legend>
      <label class="check-row"><input type="radio" name="mode" value="merge" checked> <span><strong>Merge</strong> — add new records, update ones that are newer in the file, keep everything else. Importing the same file twice changes nothing.</span></label>
      <label class="check-row"><input type="radio" name="mode" value="replace"> <span><strong>Replace</strong> — remove all current data on this device and use the file’s data instead.</span></label></fieldset>
    <label class="check-row"><input type="checkbox" name="settings" ${userRecords === 0 ? 'checked' : ''}> Also import settings (timer lengths, theme, sounds)</label>
    <p class="muted small">A safety copy of your current data is saved first, so either choice can be undone from Settings → Data.</p>`;
  const m = openModal({
    title: 'Import preview', size: 'lg', body: `<form id="import-form" class="form">${body}</form>`,
    footer: '<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="import-form" class="btn btn--primary">Import</button>',
    onMount(el, close) {
      qs('#import-form', el).addEventListener('submit', async (e) => {
        e.preventDefault();
        const mode = e.target.mode.value;
        const includeSettings = e.target.settings.checked;
        if (mode === 'replace' && userRecords > 0 && !await confirmDialog({ title: 'Replace all data?', danger: true, confirmLabel: 'Replace', message: `${userRecords.toLocaleString()} records on this device will be replaced. A safety copy is saved first.` })) return;
        try {
          const btn = el.querySelector('[type="submit"]'); if (btn) { btn.disabled = true; btn.textContent = 'Importing…'; }
          const res = await applyImport(parsed.dataset, mode, { includeSettings, reason: source === 'legacy' ? 'Before importing 1.x data' : 'Before import' });
          close(res);
          emit('import:done', res);
          toast(mode === 'replace' ? 'Data replaced from the file.' : `Imported: ${res.added} new, ${res.updated} updated, ${res.keptLocal} unchanged.`, { tone: 'success', duration: 7000 });
          onDone?.(res);
        } catch (err) { errorToast(err, 'The import failed and nothing was changed.'); close(null); }
      });
    },
  });
  return m.result;
}

async function legacyImportFlow() {
  const legacy = readLegacyLocalStorage();
  if (!legacy.found || !legacy.valid) { toast(legacy.error || 'No PomoFocus 1.x data found.', { tone: 'info' }); return; }
  // keep an untouched copy of the raw 1.x data before anything else
  const snaps = await listSnapshots();
  if (!snaps.some((s) => s.reason === 'Legacy 1.x data (raw copy)')) await createSnapshot('Legacy 1.x data (raw copy)', legacy.raw);
  const parsed = parseBackupObject(legacy.parsed);
  if (!parsed.ok) { toast(parsed.errors.join(' '), { tone: 'error' }); return; }
  await showImportPreview(parsed, { source: 'legacy' });
}

registerActions({
  setting: async (el) => {
    const { group, key, type } = el.dataset;
    let value = el.type === 'checkbox' ? el.checked : el.value;
    if (type === 'int') value = el.value === '' ? null : Number(el.value);
    if (group === 'notifications' && key === 'enabled' && value) {
      const st = await requestPermission();
      if (st !== 'granted') { toast(STATUS_TEXT[st], { tone: 'error' }); el.checked = false; value = false; }
    }
    if (group === 'general' && key === 'weekStart') value = Number(value);
    if (el.type === 'range') { const out = el.parentElement.querySelector('output'); if (out) out.textContent = `${value}%`; }
    await updateSettings({ [group]: { [key]: value } });
  },
  'settings-jump': (el) => { document.getElementById(`sec-${el.dataset.value}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); },
  'theme-set': async (el) => { await updateSettings({ appearance: { theme: el.dataset.value } }); },
  'sound-test': () => { unlockAudio(); playAlarm(state.settings.sound.alarm, state.settings.sound.volume); },
  'notify-test': async () => { const { notify } = await import('../features/notifications.js'); const ok = await notify('Winlark', 'Notifications are working.', { settings: { notifications: { enabled: true } } }); if (!ok) toast('The browser did not show the notification.', { tone: 'error' }); },
  'ambient-pick': async (el) => {
    unlockAudio();
    const v = el.dataset.value;
    await updateSettings({ ambient: { sound: v === state.settings.ambient.sound && v !== 'none' ? 'none' : v } });
  },
  'backup-export': () => { const c = downloadBackup(); toast(`Backup downloaded: ${c.tasks} tasks, ${c.sessions} sessions.`, { tone: 'success' }); },
  'backup-import': async (el) => {
    const file = el.files?.[0];
    el.value = '';
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { toast('That file is too large to be a Winlark backup.', { tone: 'error' }); return; }
    const text = await readFileText(file);
    const parsed = parseBackupText(text);
    if (!parsed.ok) {
      openModal({ title: 'This file can’t be imported', size: 'sm', body: `<ul class="plain-list">${parsed.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul><p class="muted small">Nothing was changed.</p>`, footer: '<button type="button" class="btn btn--primary" data-modal-dismiss>OK</button>' });
      return;
    }
    if (parsed.format === 'legacy-v1') await createSnapshot(`Legacy 1.x file: ${file.name}`, text);
    await showImportPreview(parsed);
  },
  'legacy-import': () => legacyImportFlow(),
  'legacy-download': () => { const l = readLegacyLocalStorage(); if (l.raw) downloadFile('pomofocus-1x-data.json', l.raw); },
  'legacy-remove': async () => {
    if (!await confirmDialog({ title: 'Remove PomoFocus 1.x data?', danger: true, confirmLabel: 'Remove', message: 'This deletes the old app’s data from this browser. Only do this after checking your data in 2.0. A raw copy stays in Safety copies until you delete it.' })) return;
    const l = readLegacyLocalStorage();
    if (l.raw) {
      const snaps = await listSnapshots();
      if (!snaps.some((s) => s.reason === 'Legacy 1.x data (raw copy)')) await createSnapshot('Legacy 1.x data (raw copy)', l.raw);
    }
    removeLegacyLocalStorage();
    toast('Old 1.x data removed.', { tone: 'success' });
    navigate(location.hash);
  },
  'snapshot-create': async () => { await createSnapshot('Manual safety copy'); toast('Safety copy saved.', { tone: 'success' }); navigate(location.hash); },
  'snapshot-download': async (el) => { const t = await getSnapshotPayload(el.dataset.id); if (t) downloadFile(`winlark-safety-copy-${el.dataset.id.slice(-6)}.json`, t); },
  'snapshot-delete': async (el) => {
    if (!await confirmDialog({ title: 'Delete this safety copy?', danger: true, confirmLabel: 'Delete' })) return;
    await deleteSnapshot(el.dataset.id); navigate(location.hash);
  },
  'snapshot-restore': async (el) => {
    if (!await confirmDialog({ title: 'Restore this safety copy?', confirmLabel: 'Restore', message: 'Your current data will be replaced by the copy. Your current data is saved as a new safety copy first.' })) return;
    const counts = await restoreSnapshot(el.dataset.id);
    toast(`Restored ${counts.tasks} tasks and ${counts.sessions} sessions.`, { tone: 'success' });
    emit('import:done', {});
  },
  'data-reset': async () => {
    if (!await confirmDialog({ title: 'Delete all data?', danger: true, confirmLabel: 'Delete everything', message: 'All tasks, sessions, objectives, habits, plans and reviews on this device will be deleted. Settings are kept. A safety copy is saved first so you can restore it from this page.' })) return;
    await resetAllData();
    emit('import:done', {});
    toast('All data deleted. A safety copy was kept.', { tone: 'success' });
  },
  'an-recalc-settings': () => { clearDerivedCaches(); toast('Analytics recalculated from your records.', { tone: 'success' }); },
  'storage-persist': async (el) => {
    if (!navigator.storage?.persist) { toast('This browser does not support persistent storage.', { tone: 'info' }); return; }
    const ok = await navigator.storage.persist();
    toast(ok ? 'The browser will keep Winlark data unless you delete it.' : 'The browser declined. Installing the app or using it more often can help — and keep exporting backups.', { tone: ok ? 'success' : 'info' });
    if (ok) { el.disabled = true; el.textContent = 'Data is kept permanently'; }
  },
  'app-update-check': async () => {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (!reg) { toast('Offline support is not active.', { tone: 'info' }); return; }
    await reg.update();
    toast(reg.waiting || reg.installing ? 'An update is downloading.' : 'You have the latest version.', { tone: 'info' });
  },
});

export { legacyImportFlow };
