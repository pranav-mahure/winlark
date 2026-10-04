/**
 * Pomodoro timer engine.
 *
 * Time is never counted by decrementing a variable. The running state stores
 * absolute timestamps:
 *   startedAt   when the current running segment began
 *   endsAt      when the session will finish if it keeps running
 *   elapsedMs   time already run in earlier segments (before pauses)
 * Remaining time is always endsAt − now, so throttled background tabs, sleep,
 * or a page refresh cannot drift the clock. The state is persisted (meta
 * 'timer') on every transition and restored at boot.
 *
 * A completed session is written once, with id `s_<sessionStart>`, so two
 * tabs finishing the same session cannot create a duplicate record.
 */
import { state, get, getMeta, setMeta } from '../core/state.js';
import { emit } from '../core/events.js';
import { TIMER_MODES } from '../core/constants.js';
import { keyFromTs } from '../utils/dates.js';
import { recordSession } from './sessions.js';

const DEFAULT = {
  mode: 'focus', status: 'idle', durationMs: null, startedAt: null, endsAt: null,
  elapsedMs: 0, sessionStart: null, cycle: 0, taskId: null,
};
const MIN_RECORD_MS = 60000; // a focus session stopped early is kept if it ran ≥ 1 min

let t = { ...DEFAULT };
let loop = null;
let lastSecond = null;
let completing = false;

export function modeDuration(mode, settings = state.settings) {
  return settings.timer[TIMER_MODES[mode].settingKey] * 60000;
}

function elapsedNow(now = Date.now()) {
  if (t.status === 'running') return t.elapsedMs + (now - t.startedAt);
  return t.elapsedMs;
}

export function timerView(now = Date.now()) {
  const duration = t.durationMs ?? modeDuration(t.mode);
  const remaining = t.status === 'running' ? Math.max(0, t.endsAt - now) : Math.max(0, duration - t.elapsedMs);
  return {
    mode: t.mode, status: t.status, durationMs: duration, remainingMs: remaining,
    elapsedMs: Math.min(duration, elapsedNow(now)), progress: duration ? 1 - remaining / duration : 0,
    taskId: t.taskId, cycle: t.cycle, longEvery: state.settings.timer.longEvery,
    sessionStart: t.sessionStart, endsAt: t.endsAt,
  };
}

async function persist() {
  try {
    await setMeta('timer', { ...t }, { silent: true });
    emit('timer:persisted');
  } catch (err) { console.error('[timer] could not persist state', err); }
}

function announce() { emit('timer:state', timerView()); }

function startLoop() {
  if (loop) return;
  lastSecond = null;
  loop = setInterval(check, 250);
}
function stopLoop() { clearInterval(loop); loop = null; }

/** Called by the loop, on visibility change and at boot. */
export function check() {
  if (t.status !== 'running') return;
  const now = Date.now();
  if (now >= t.endsAt) { completeCurrent({ restored: false, now }); return; }
  const v = timerView(now);
  const sec = Math.ceil(v.remainingMs / 1000);
  if (sec !== lastSecond) {
    lastSecond = sec;
    emit('timer:second', v);
  }
  emit('timer:tick', v);
}

export async function initTimer() {
  const saved = getMeta('timer');
  t = { ...DEFAULT, ...(saved && typeof saved === 'object' ? saved : {}) };
  if (!TIMER_MODES[t.mode]) t = { ...DEFAULT };
  if (t.taskId && !get('tasks', t.taskId)) t.taskId = null;
  if (t.status === 'idle' || !t.durationMs) t.durationMs = modeDuration(t.mode);
  if (t.status === 'running' && !(t.endsAt > 0)) t.status = 'idle';
  if (t.status === 'running' && Date.now() >= t.endsAt) {
    await completeCurrent({ restored: true });
    return;
  }
  if (t.status === 'running') startLoop();
  announce();
}

export function start() {
  if (t.status === 'running') return;
  const now = Date.now();
  if (t.status === 'idle') {
    t.durationMs = modeDuration(t.mode);
    t.elapsedMs = 0;
    t.sessionStart = now;
  }
  t.startedAt = now;
  t.endsAt = now + (t.durationMs - t.elapsedMs);
  t.status = 'running';
  startLoop();
  persist();
  announce();
  emit('timer:started', timerView());
}

export function pause() {
  if (t.status !== 'running') return;
  const now = Date.now();
  t.elapsedMs += now - t.startedAt;
  t.startedAt = null;
  t.endsAt = null;
  t.status = 'paused';
  stopLoop();
  persist();
  announce();
  emit('timer:paused', timerView());
}

export function toggle() {
  if (t.status === 'running') pause(); else start();
}

/** Discard the current session. Returns a token that undoReset() accepts. */
export function reset() {
  const before = { ...t, elapsedMs: elapsedNow(), status: t.status === 'running' ? 'paused' : t.status, startedAt: null, endsAt: null };
  stopLoop();
  t = { ...t, status: 'idle', startedAt: null, endsAt: null, elapsedMs: 0, sessionStart: null, durationMs: modeDuration(t.mode) };
  persist();
  announce();
  emit('timer:reset', timerView());
  return before;
}

export function undoReset(before) {
  if (!before || t.status !== 'idle') return;
  t = { ...before };
  persist();
  announce();
}

function nextModeAfter(mode) {
  if (mode === 'focus') {
    return t.cycle > 0 && t.cycle % state.settings.timer.longEvery === 0 ? 'longBreak' : 'shortBreak';
  }
  return 'focus';
}

function enterMode(mode, { autoStart = false } = {}) {
  if (mode === 'focus' && t.mode === 'longBreak') t.cycle = 0;
  t.mode = mode;
  t.status = 'idle';
  t.startedAt = null; t.endsAt = null; t.elapsedMs = 0; t.sessionStart = null;
  t.durationMs = modeDuration(mode);
  if (autoStart) {
    start();
  } else {
    stopLoop();
    persist();
    announce();
  }
}

async function completeCurrent({ restored = false, now = Date.now() } = {}) {
  if (completing) return;
  completing = true;
  stopLoop();
  const mode = t.mode;
  const end = t.endsAt;
  const sessionStart = t.sessionStart ?? (end - t.durationMs);
  const id = `s_${sessionStart}`;
  let session = state.sessions.get(id) || null;
  try {
    if (!session) {
      session = await recordSession({
        id, type: mode, taskId: mode === 'focus' ? t.taskId : null,
        date: keyFromTs(end - 1), startTime: sessionStart, endTime: end,
        plannedDuration: Math.round(t.durationMs / 1000), actualDuration: Math.round(t.durationMs / 1000),
        completed: true, source: 'timer', durationSource: 'measured',
      });
    }
  } catch (err) {
    console.error('[timer] could not save session', err);
    emit('timer:error', { message: 'The session finished but could not be saved.', error: err });
  }
  if (mode === 'focus') t.cycle += 1;
  // A finished task should not keep receiving new sessions.
  const task = t.taskId ? get('tasks', t.taskId) : null;
  const clearedTask = task && (task.status === 'completed' || task.status === 'archived') ? task : null;
  if (clearedTask || (t.taskId && !task)) t.taskId = null;
  const next = nextModeAfter(mode);
  const s = state.settings.timer;
  const auto = !restored && (next === 'focus' ? s.autoStartFocus : s.autoStartBreak);
  completing = false;
  enterMode(next, { autoStart: auto });
  emit('session:completed', { session, mode, next, restored, auto, clearedTask, at: now });
}

/** Skip to the next phase. A focus session that ran ≥ 1 min is kept as "stopped early" (not counted). */
export async function skip() {
  const now = Date.now();
  const mode = t.mode;
  const elapsed = elapsedNow(now);
  let saved = null;
  if (mode === 'focus' && t.status !== 'idle' && elapsed >= MIN_RECORD_MS) {
    try {
      saved = await recordSession({
        id: `s_${t.sessionStart}`, type: 'focus', taskId: t.taskId, date: keyFromTs(now),
        startTime: t.sessionStart, endTime: now, plannedDuration: Math.round(t.durationMs / 1000),
        actualDuration: Math.round(elapsed / 1000), completed: false, source: 'timer', durationSource: 'measured',
      });
    } catch (err) { console.error('[timer] could not save stopped session', err); }
  }
  const next = mode === 'focus' ? (t.cycle >= state.settings.timer.longEvery ? 'longBreak' : 'shortBreak') : 'focus';
  enterMode(next);
  emit('timer:skipped', { from: mode, to: next, saved });
}

export function setMode(mode) {
  if (!TIMER_MODES[mode] || (mode === t.mode && t.status === 'idle')) return;
  enterMode(mode);
}

export function setTask(taskId) {
  t.taskId = taskId || null;
  persist();
  announce();
}

export function activeTaskId() { return t.taskId; }

export function hasProgress() { return t.status !== 'idle' && elapsedNow() > 0; }

/** Settings changed: an idle timer picks up the new length immediately. */
export function settingsChanged() {
  if (t.status === 'idle') {
    t.durationMs = modeDuration(t.mode);
    announce();
  }
}

/** Data changed elsewhere (task deleted, import): drop a dangling task link. */
export function dataChanged() {
  if (t.taskId && !get('tasks', t.taskId)) { t.taskId = null; persist(); announce(); }
}
