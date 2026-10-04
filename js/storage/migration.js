/**
 * Legacy (PomoFocus 1.x) → PomoFocus 2.0 migration.
 *
 * v1 kept history in three overlapping places:
 *   1. tasks[].sessions   — one {date} entry per Pomodoro credited to a task
 *   2. dailyStats[date]   — per-day totals {pomos, focusMin, byProject}
 *   3. stats              — lifetime totals {totalPomos, totalFocus, streak}
 * plus history[], a log of "task marked done" events with real timestamps.
 *
 * Representations 1–3 describe the SAME Pomodoros, so converting more than
 * one into sessions would double-count. Strategy:
 *
 *   • Each tasks[].sessions entry becomes one canonical focus session (it
 *     carries the task link). Its duration is DERIVED from dailyStats for that
 *     date+project (focusMin ÷ pomos) — v1 added the then-current Pomodoro
 *     length per session, so on single-length days this is exact.
 *   • Where dailyStats counts more Pomodoros than task sessions explain (focus
 *     run with no task, or credited to a since-deleted task), the difference
 *     becomes "unassigned" legacy sessions, with the leftover minutes.
 *   • stats.* is not stored; it is used only to verify the result.
 *
 * No start/end times are invented (startTime/endTime stay null and every
 * record is marked source:'legacy'). IDs are derived from legacy IDs, so
 * importing the same file twice overwrites rather than duplicates. Records
 * use legacy timestamps, never Date.now(), so the output is deterministic.
 *
 * Task completion (v1 `done`) is kept exactly as it was, independently of
 * Pomodoro progress — v1 data has tasks marked done at 3 of 4 Pomodoros.
 */
import { keyFromTs, isValidKey, weekday } from '../utils/dates.js';
import { hashString } from '../utils/ids.js';
import { THEMES, ALARMS, AMBIENTS, LEGACY_STORAGE_KEY, DEFAULT_SETTINGS } from '../core/constants.js';

export function isLegacyFormat(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) && !obj.app
    && Array.isArray(obj.tasks)
    && ('cfg' in obj || 'dailyStats' in obj || 'stats' in obj || 'history' in obj);
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const clampInt = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

export function migrateSettings(cfg = {}) {
  const d = DEFAULT_SETTINGS;
  const theme = THEMES.find((t) => t.legacyIndex === Number(cfg.theme))?.id || d.appearance.theme;
  return {
    id: 'app',
    timer: {
      focusMin: clampInt(cfg.pomo, 1, 180, d.timer.focusMin),
      shortMin: clampInt(cfg.short, 1, 120, d.timer.shortMin),
      longMin: clampInt(cfg.long, 1, 180, d.timer.longMin),
      longEvery: clampInt(cfg.lbAfter, 1, 12, d.timer.longEvery),
      autoStartBreak: !!cfg.autoBreak,
      autoStartFocus: !!cfg.autoPomo,
    },
    goals: { ...d.goals, dailyPomos: clampInt(cfg.dailyGoal, 0, 50, d.goals.dailyPomos) },
    notifications: { enabled: !!cfg.notif },
    sound: {
      alarm: ALARMS.some((a) => a.id === cfg.sound) ? cfg.sound : 'bell',
      volume: clampInt(cfg.vol, 0, 100, d.sound.volume),
      tick: !!cfg.tick,
    },
    ambient: { sound: AMBIENTS.some((a) => a.id === cfg.ambient) ? cfg.ambient : 'none', volume: d.ambient.volume, mode: 'always' },
    appearance: { theme, motion: 'system' },
    general: { ...d.general },
  };
}

/**
 * @param {object} legacy  parsed v1 JSON (export file or localStorage value)
 * @returns {{ dataset: object, report: object }}
 */
export function migrateLegacy(legacy) {
  const warnings = [];
  const notes = [];
  const cfg = legacy.cfg && typeof legacy.cfg === 'object' ? legacy.cfg : {};
  const settings = migrateSettings(cfg);
  const dailyStats = legacy.dailyStats && typeof legacy.dailyStats === 'object' ? legacy.dailyStats : {};
  const stats = legacy.stats && typeof legacy.stats === 'object' ? legacy.stats : {};

  // ---------- projects ----------
  const projects = [];
  const projectIds = new Set();
  (Array.isArray(legacy.projects) ? legacy.projects : []).forEach((p, i) => {
    if (!p || typeof p !== 'object') return;
    const name = String(p.name ?? '').trim() || `Project ${i + 1}`;
    const pid = p.id != null && String(p.id).trim() ? String(p.id) : `lg_p${hashString(name)}`;
    if (projectIds.has(pid)) { warnings.push(`Duplicate project ID ${pid} — kept the first.`); return; }
    const createdAt = /^p(\d{10,})$/.test(pid) ? Number(pid.slice(1)) : 0;
    projectIds.add(pid);
    projects.push({ id: pid, name, color: p.color, description: '', archived: false, order: i * 1024, createdAt, updatedAt: createdAt });
  });

  const placeholder = (pid) => {
    if (!pid || projectIds.has(pid)) return;
    projectIds.add(pid);
    projects.push({
      id: pid, name: `Imported project ${pid}`, color: '#64748b', archived: false, order: projects.length * 1024,
      description: 'Created during migration: tasks referenced this project ID, but the backup did not contain it.',
      createdAt: 0, updatedAt: 0,
    });
    warnings.push(`Tasks referenced a missing project (${pid}); a placeholder project was created so the link is kept.`);
  };

  // ---------- per-day durations from dailyStats ----------
  const durationFor = (date, pid) => {
    const ds = dailyStats[date];
    if (!ds) return null;
    const bp = ds.byProject?.[pid || '__none__'];
    if (bp && finite(bp.pomos) && bp.pomos > 0 && finite(bp.focusMin)) {
      const min = bp.focusMin / bp.pomos;
      return { sec: Math.round(min * 60), source: Number.isInteger(min) ? 'legacy-daily-total' : 'legacy-daily-average' };
    }
    if (finite(ds.pomos) && ds.pomos > 0 && finite(ds.focusMin)) {
      const min = ds.focusMin / ds.pomos;
      return { sec: Math.round(min * 60), source: 'legacy-daily-average' };
    }
    return null;
  };

  // ---------- tasks + task sessions ----------
  const tasks = [];
  const sessions = [];
  const attributed = new Map(); // date -> { count, sec, byPid: Map(pid -> count) }
  const legacyTaskById = new Map();
  let invalidSessionDates = 0;
  let assumedDurations = 0;
  const usedTaskIds = new Set();

  (Array.isArray(legacy.tasks) ? legacy.tasks : []).forEach((t, i) => {
    if (!t || typeof t !== 'object') { warnings.push(`Task #${i + 1} was not an object and was skipped.`); return; }
    const rawId = t.id != null && String(t.id).trim() ? String(t.id) : `noid${hashString(`${t.name}|${t.created}|${i}`)}`;
    let id = `lg_t${rawId}`;
    if (usedTaskIds.has(id)) { id = `${id}_${i}`; warnings.push(`Duplicate task ID ${rawId}; the second copy was given a distinct ID.`); }
    usedTaskIds.add(id);

    const recurring = t.recurring === 'daily' || t.recurring === 'weekly';
    const pomos = clampInt(t.pomos, 0, 999, 0);
    const donePomos = clampInt(t.done_pomos, 0, 999, 0);
    const created = finite(t.created) ? t.created : (finite(Number(t.id)) && Number(t.id) > 1e11 ? Number(t.id) : 0);
    const createdKey = created ? keyFromTs(created) : null;
    let projectId = t.projectId ? String(t.projectId) : null;
    if (projectId && !projectIds.has(projectId)) placeholder(projectId);
    const sessionList = Array.isArray(t.sessions) ? t.sessions : [];

    // sessions
    let validSessions = 0;
    sessionList.forEach((s, j) => {
      const date = s && typeof s === 'object' ? s.date : null;
      if (!isValidKey(date)) { invalidSessionDates++; return; }
      validSessions++;
      let dur = durationFor(date, projectId);
      if (!dur) {
        dur = { sec: settings.timer.focusMin * 60, source: 'legacy-assumed-setting' };
        assumedDurations++;
      }
      sessions.push({
        id: `lg_s${rawId}_${j}`, type: 'focus', taskId: id, objectiveId: null, projectId,
        date, startTime: null, endTime: null, plannedDuration: null, actualDuration: dur.sec,
        completed: true, source: 'legacy', durationSource: dur.source, notes: '',
        legacyRef: { taskId: rawId, index: j }, createdAt: created, updatedAt: created,
      });
      const a = attributed.get(date) || { count: 0, sec: 0, byPid: new Map() };
      a.count++; a.sec += dur.sec;
      const pk = projectId || '__none__';
      a.byPid.set(pk, (a.byPid.get(pk) || 0) + 1);
      attributed.set(date, a);
    });

    const title = String(t.name ?? '').trim() || 'Untitled task';
    const base = {
      id, title, notes: typeof t.notes === 'string' ? t.notes : '',
      priority: ['low', 'med', 'high'].includes(t.priority) ? t.priority : 'low',
      projectId, objectiveId: null, tags: [],
      estimate: pomos, originalEstimate: pomos,
      estimateHistory: [{ value: pomos, at: created || null, source: 'legacy' }],
      moveHistory: [], dependsOn: [], order: i * 1024, dueDate: null,
      createdAt: created, updatedAt: created,
      legacy: {
        id: t.id ?? null, pomos, done_pomos: donePomos, done: !!t.done, recurring: t.recurring ?? 'none',
        lastResetDate: t.lastResetDate ?? null, sessionCount: validSessions, created: t.created ?? null,
      },
    };

    if (recurring) {
      const startDate = createdKey;
      // v1 recurring targets grew across days (done_pomos only reset when the task was ticked),
      // so they are not a per-day estimate. Each day starts unestimated; the v1 value stays in legacy.pomos.
      tasks.push({
        ...base, kind: 'series', status: 'active', plannedDate: null,
        estimate: null, originalEstimate: null, estimateHistory: [],
        recurrence: t.recurring === 'daily'
          ? { freq: 'daily', days: [], interval: 1, startDate }
          : { freq: 'weekly', days: [createdKey ? weekday(createdKey) : 1], interval: 1, startDate },
        skippedDates: [],
        estimateReliable: false,
        estimateNote: `v1 recurring target was ${pomos} Pomodoros, accumulated across days, so it is not used as a daily estimate.`,
      });
    } else {
      // v1 could silently raise the estimate to match progress (done_pomos > pomos ⇒ pomos = done_pomos),
      // so an estimate equal to progress cannot be trusted as the original plan.
      const reliable = pomos > 0 && Math.max(donePomos, validSessions) < pomos;
      tasks.push({
        ...base, kind: 'single', recurrence: null, plannedDate: null,
        status: t.done ? 'completed' : (validSessions > 0 ? 'in-progress' : 'inbox'),
        completedAt: null, completedDate: null,
        estimateReliable: reliable,
        ...(reliable ? {} : { estimateNote: 'v1 automatically raised estimates when progress exceeded them; the original estimate is unknown.' }),
      });
    }
    legacyTaskById.set(id, { t, created, recurring });
  });

  // ---------- unassigned gap sessions (dailyStats > task sessions) ----------
  let gapSessions = 0;
  let overAttributedDays = 0;
  let invalidDays = 0;
  for (const [date, ds] of Object.entries(dailyStats)) {
    if (!isValidKey(date) || !ds || typeof ds !== 'object') { invalidDays++; continue; }
    const total = clampInt(ds.pomos, 0, 10000, 0);
    const totalMin = finite(ds.focusMin) ? ds.focusMin : 0;
    const a = attributed.get(date) || { count: 0, sec: 0, byPid: new Map() };
    if (a.count > total) { overAttributedDays++; continue; }
    let remaining = total - a.count;
    if (remaining <= 0) continue;
    let remainingSec = Math.max(0, Math.round(totalMin * 60) - a.sec);
    let k = 0;
    const emit = (count, sec, pid) => {
      const per = count > 0 ? Math.round(sec / count) : 0;
      for (let n = 0; n < count; n++) {
        sessions.push({
          id: `lg_g${date}_${k++}`, type: 'focus', taskId: null, objectiveId: null,
          projectId: pid && projectIds.has(pid) ? pid : null, date,
          startTime: null, endTime: null, plannedDuration: null, actualDuration: per,
          completed: true, source: 'legacy', durationSource: 'legacy-daily-remainder', notes: '',
          legacyRef: { unattributed: true }, createdAt: 0, updatedAt: 0,
        });
        gapSessions++;
      }
    };
    // project-level gaps first (credited to a project in v1, but no surviving task session)
    for (const [pid, bp] of Object.entries(ds.byProject || {})) {
      const got = a.byPid.get(pid) || 0;
      const gap = clampInt(bp?.pomos, 0, 10000, 0) - got;
      if (gap > 0 && remaining > 0) {
        const n = Math.min(gap, remaining);
        const per = finite(bp.focusMin) && bp.pomos > 0 ? bp.focusMin / bp.pomos : totalMin / Math.max(total, 1);
        const sec = Math.min(remainingSec, Math.round(per * 60 * n));
        emit(n, sec, pid === '__none__' ? null : pid);
        remaining -= n; remainingSec -= sec;
      }
    }
    if (remaining > 0) emit(remaining, remainingSec, null);
  }

  // ---------- history → activity + completion timestamps ----------
  const activity = [];
  const eventsByTask = new Map();
  const usedActivityIds = new Set();
  const nameIndex = new Map();
  for (const task of tasks) {
    const list = nameIndex.get(task.title) || [];
    list.push(task);
    nameIndex.set(task.title, list);
  }
  (Array.isArray(legacy.history) ? legacy.history : []).forEach((h, k) => {
    if (!h || typeof h !== 'object' || !finite(h.ts)) return;
    const name = String(h.name ?? '').trim();
    const pid = h.projectId === undefined ? undefined : (h.projectId ? String(h.projectId) : null);
    let candidates = nameIndex.get(name) || [];
    if (pid !== undefined) {
      const sameProject = candidates.filter((c) => (c.projectId || null) === pid);
      if (sameProject.length) candidates = sameProject;
    }
    const before = candidates.filter((c) => !c.createdAt || c.createdAt <= h.ts + 60000);
    const pool = before.length ? before : candidates;
    const match = pool.reduce((best, c) => (!best || (c.createdAt || 0) > (best.createdAt || 0) ? c : best), null);
    let aid = `lg_h${h.ts}_${hashString(name)}`;
    if (usedActivityIds.has(aid)) aid = `${aid}_${k}`;
    usedActivityIds.add(aid);
    const rec = {
      id: aid, type: h.type === 'task' ? 'task-completed' : String(h.type || 'event'),
      ts: h.ts, date: keyFromTs(h.ts), taskId: match ? match.id : null, title: name || 'Untitled task',
      projectId: pid && projectIds.has(pid) ? pid : (match?.projectId ?? null),
      source: 'legacy', countsAsCompletion: true, note: match ? '' : 'Task no longer exists in v1 data',
      createdAt: h.ts, updatedAt: h.ts,
    };
    activity.push(rec);
    if (match) {
      const list = eventsByTask.get(match.id) || [];
      list.push(rec);
      eventsByTask.set(match.id, list);
    }
  });

  let doneWithoutEvent = 0;
  for (const task of tasks) {
    const events = (eventsByTask.get(task.id) || []).sort((a, b) => a.ts - b.ts);
    if (task.kind === 'series') {
      // each event = that day's occurrence was completed in v1
      for (const e of events) { e.countsAsCompletion = true; e.note = 'Recurring task completed (v1)'; }
      continue;
    }
    // single task: completion lives on the task itself, so events must not count twice
    for (const e of events) e.countsAsCompletion = false;
    if (task.status === 'completed') {
      const last = events[events.length - 1];
      if (last) {
        task.completedAt = last.ts;
        task.completedDate = last.date;
        last.note = 'Completed (v1)';
        for (const e of events.slice(0, -1)) e.note = 'Marked done earlier, then reopened (v1)';
      } else {
        doneWithoutEvent++;
      }
    } else {
      for (const e of events) e.note = 'Marked done, later reopened (v1)';
    }
  }
  if (doneWithoutEvent) notes.push(`${doneWithoutEvent} completed task(s) had no completion event in v1, so their completion date is unknown (they still count as completed).`);

  // ---------- default streak that matches v1's streak rule ----------
  const streaks = [{
    id: 'lg_streak_focus', name: 'Daily focus', metric: 'pomodoros', threshold: 1, habitIds: [],
    frequency: 'daily', activeDays: [0, 1, 2, 3, 4, 5, 6], enabled: true, order: 0, createdAt: 0, updatedAt: 0,
  }];

  // ---------- verification against v1's own totals ----------
  const dsPomos = Object.entries(dailyStats).reduce((s, [k, v]) => s + (isValidKey(k) && finite(v?.pomos) ? v.pomos : 0), 0);
  const dsFocus = Object.entries(dailyStats).reduce((s, [k, v]) => s + (isValidKey(k) && finite(v?.focusMin) ? v.focusMin : 0), 0);
  const migratedPomos = sessions.length;
  const migratedFocusMin = Math.round(sessions.reduce((s, x) => s + (x.actualDuration || 0), 0) / 60);
  const perDay = new Map();
  for (const s of sessions) {
    const d = perDay.get(s.date) || { n: 0, sec: 0 };
    d.n++; d.sec += s.actualDuration || 0; perDay.set(s.date, d);
  }
  let dayMismatches = 0;
  for (const [date, ds] of Object.entries(dailyStats)) {
    if (!isValidKey(date)) continue;
    const m = perDay.get(date) || { n: 0, sec: 0 };
    if (m.n !== (ds.pomos || 0) || Math.round(m.sec / 60) !== Math.round(ds.focusMin || 0)) dayMismatches++;
  }
  const checks = [
    { label: 'Pomodoros match v1 daily totals', ok: migratedPomos === dsPomos, detail: `${migratedPomos} migrated / ${dsPomos} in v1 daily totals` },
    { label: 'Focus minutes match v1 daily totals', ok: migratedFocusMin === Math.round(dsFocus), detail: `${migratedFocusMin} / ${Math.round(dsFocus)} min` },
    { label: 'Every day matches v1', ok: dayMismatches === 0, detail: dayMismatches ? `${dayMismatches} day(s) differ` : `${Object.keys(dailyStats).length} days checked` },
  ];
  if (finite(stats.totalPomos)) checks.push({ label: 'Lifetime Pomodoros match v1', ok: stats.totalPomos === migratedPomos, detail: `${migratedPomos} / ${stats.totalPomos}` });
  if (finite(stats.totalFocus)) checks.push({ label: 'Lifetime focus matches v1', ok: Math.round(stats.totalFocus) === migratedFocusMin, detail: `${migratedFocusMin} / ${Math.round(stats.totalFocus)} min` });

  if (invalidSessionDates) warnings.push(`${invalidSessionDates} task session(s) had no valid date and could not be placed on a day.`);
  if (assumedDurations) warnings.push(`${assumedDurations} session(s) had no daily total to derive a duration from; the v1 Pomodoro length (${settings.timer.focusMin} min) was used.`);
  if (overAttributedDays) warnings.push(`${overAttributedDays} day(s) had more task sessions than v1's daily total; task sessions were kept.`);
  if (invalidDays) warnings.push(`${invalidDays} daily total(s) had an invalid date and were ignored.`);
  if (gapSessions) notes.push(`${gapSessions} Pomodoro(s) were recorded in v1 without a task; they appear as unassigned sessions you can assign later.`);
  const series = tasks.filter((t) => t.kind === 'series');
  if (series.length) notes.push(`${series.length} recurring task(s) became repeating series. Their v1 targets (${series.map((s) => `${s.title}: ${s.estimate}`).join(', ')}) are kept as per-day estimates — review them if they look high.`);
  const unreliable = tasks.filter((t) => t.kind === 'single' && !t.estimateReliable).length;
  if (unreliable) notes.push(`${unreliable} task estimate(s) may have been raised automatically by v1; Planning analytics excludes them by default.`);
  const weekly = series.filter((s) => s.recurrence.freq === 'weekly');
  if (weekly.length) notes.push(`Weekly repeats now fall on a fixed weekday (the day each task was created). You can change this in the task.`);
  notes.push('Legacy sessions keep their original dates; v1 did not record start times, so they are excluded from time-of-day charts.');

  const dataset = {
    settings,
    projects, objectives: [], tasks, dailyPlans: [], habits: [], habitCompletions: [],
    sessions, streaks, reviews: [], activity,
  };
  const report = {
    source: 'legacy-v1',
    counts: {
      projects: projects.length,
      tasks: tasks.length,
      recurring: series.length,
      completed: tasks.filter((t) => t.status === 'completed').length,
      open: tasks.filter((t) => t.kind === 'single' && t.status !== 'completed').length,
      withNotes: tasks.filter((t) => t.notes).length,
      taskSessions: sessions.length - gapSessions,
      unassignedSessions: gapSessions,
      activity: activity.length,
    },
    totals: {
      legacyTotalPomos: finite(stats.totalPomos) ? stats.totalPomos : null,
      legacyTotalFocus: finite(stats.totalFocus) ? stats.totalFocus : null,
      legacyStreak: finite(stats.streak) ? stats.streak : null,
      legacyStreakDate: stats.lastDate ?? null,
      dailyStatsPomos: dsPomos,
      dailyStatsFocus: dsFocus,
      migratedPomos,
      migratedFocusMin,
    },
    checks,
    notes,
    warnings,
    legacyTimer: { pomosThisRound: clampInt(legacy.pomosThisRound, 0, 12, 0), mode: legacy.mode || null },
  };
  return { dataset, report };
}

/** Reads the legacy localStorage key, if present and parseable. */
export function readLegacyLocalStorage() {
  let raw = null;
  try { raw = localStorage.getItem(LEGACY_STORAGE_KEY); } catch { return { found: false }; }
  if (!raw) return { found: false };
  try {
    const parsed = JSON.parse(raw);
    if (!isLegacyFormat(parsed)) return { found: true, valid: false, raw, error: 'The stored data is not in the PomoFocus 1.x format.' };
    return { found: true, valid: true, raw, parsed };
  } catch (err) {
    return { found: true, valid: false, raw, error: 'The stored data is not valid JSON.' };
  }
}

export function removeLegacyLocalStorage() {
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); return true; } catch { return false; }
}
