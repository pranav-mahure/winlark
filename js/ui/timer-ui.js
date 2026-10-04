/**
 * Timer widgets. The Focus Dial shows two things at once:
 *   outer segmented ring — today's Pomodoros against the daily goal
 *   inner ring           — progress of the current session
 * Widgets are rendered as HTML strings with the views, then updated in place
 * on every timer tick (no full re-render while the clock runs).
 */
import { state, get } from '../core/state.js';
import { esc, qsa } from '../utils/dom.js';
import { fmtClock } from '../utils/format.js';
import { todayKey } from '../utils/dates.js';
import { icon } from './icons.js';
import { timerView } from '../features/timer.js';
import { focusOn } from '../features/analytics.js';
import { TIMER_MODES } from '../core/constants.js';
import { projectChip, pips } from './components.js';
import { taskActual } from '../features/sessions.js';

const R_IN = 92;
const C_IN = 2 * Math.PI * R_IN;
export const MODE_LABEL = { focus: 'Focus', shortBreak: 'Short break', longBreak: 'Long break' };

function goalRing(done, goal, cx, r) {
  if (!goal) {
    return `<circle cx="${cx}" cy="${cx}" r="${r}" class="dial__goal-track"/>`;
  }
  const n = Math.min(goal, 24);
  const gap = n > 12 ? 3 : 5; // degrees
  const seg = 360 / n - gap;
  let out = '';
  for (let i = 0; i < n; i++) {
    const a0 = -90 + i * (360 / n) + gap / 2;
    const a1 = a0 + seg;
    const p0 = polar(cx, r, a0); const p1 = polar(cx, r, a1);
    const large = seg > 180 ? 1 : 0;
    out += `<path d="M${p0.x} ${p0.y} A${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}" class="dial__seg${i < done ? ' is-done' : ''}"/>`;
  }
  return out;
}

function polar(c, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: +(c + r * Math.cos(rad)).toFixed(2), y: +(c + r * Math.sin(rad)).toFixed(2) };
}

export function dialSvg(v = timerView(), { size = 260 } = {}) {
  const today = focusOn(todayKey()).pomos;
  const goal = state.settings.goals.dailyPomos;
  const offset = C_IN * (1 - v.progress);
  const filled = v.mode === 'longBreak' && v.cycle > 0 && v.cycle % v.longEvery === 0 ? v.longEvery : v.cycle % v.longEvery;
  const cycleDots = Array.from({ length: v.longEvery }, (_, i) => `<span class="dial__cycle-dot${i < filled ? ' is-done' : ''}"></span>`).join('');
  const over = goal && today > goal ? `<span class="dial__over">+${today - goal}</span>` : '';
  return `<div class="dial dial--${v.mode} is-${v.status}" style="--dial-size:${size}px" data-dial>
    <svg viewBox="0 0 240 240" class="dial__svg" aria-hidden="true">
      <g class="dial__goal">${goalRing(today, goal, 120, 112)}</g>
      <circle cx="120" cy="120" r="${R_IN}" class="dial__track"/>
      <circle cx="120" cy="120" r="${R_IN}" class="dial__progress" data-dial-progress stroke-dasharray="${C_IN.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" transform="rotate(-90 120 120)"/>
    </svg>
    <div class="dial__center">
      <span class="dial__mode">${MODE_LABEL[v.mode]}</span>
      <span class="dial__time" data-timer-text role="timer" aria-live="off">${fmtClock(v.remainingMs / 1000)}</span>
      <span class="dial__cycle" title="Pomodoros this round">${cycleDots}</span>
      <span class="dial__today" title="Today's Pomodoros / daily goal">${today}${goal ? ` / ${goal}` : ''} today${over}</span>
    </div>
  </div>`;
}

export function modeTabs(v = timerView()) {
  return `<div class="mode-tabs" role="group" aria-label="Timer mode">${Object.keys(TIMER_MODES).map((m) =>
    `<button type="button" class="mode-tab${v.mode === m ? ' is-on' : ''}" data-action="timer-mode" data-mode="${m}" aria-pressed="${v.mode === m}">${MODE_LABEL[m]}</button>`).join('')}</div>`;
}

export function controls(v = timerView(), { big = false } = {}) {
  const running = v.status === 'running';
  const label = running ? 'Pause' : v.status === 'paused' ? 'Resume' : 'Start';
  return `<div class="timer-controls${big ? ' timer-controls--big' : ''}">
    <button type="button" class="icon-btn icon-btn--ring" data-action="timer-reset" aria-label="Reset timer" title="Reset (Shift+R)" ${v.status === 'idle' ? 'disabled' : ''}>${icon('reset', { size: 18 })}</button>
    <button type="button" class="btn btn--primary btn--start" data-action="timer-toggle" data-timer-toggle aria-label="${label} timer (Space)">${icon(running ? 'pause' : 'play', { size: 18 })}<span>${label}</span></button>
    <button type="button" class="icon-btn icon-btn--ring" data-action="timer-skip" aria-label="Skip to next phase" title="Skip (S)">${icon('skip', { size: 18 })}</button>
  </div>`;
}

/** The "currently focusing on" line under the dial. */
export function currentTaskLine(v = timerView()) {
  if (v.mode !== 'focus') {
    return `<div class="current-task current-task--break"><span class="current-task__label">${v.mode === 'longBreak' ? 'Long break' : 'Break'}</span><span class="current-task__title">Step away from the screen for a moment.</span></div>`;
  }
  const task = v.taskId ? get('tasks', v.taskId) : null;
  if (!task) {
    return `<div class="current-task is-empty"><span class="current-task__label">No task selected</span>
      <span class="current-task__title">Sessions without a task are saved as unassigned. You can assign them later in History.</span>
      <button type="button" class="btn btn--small btn--secondary" data-action="pick-active-task">Choose a task</button></div>`;
  }
  const a = taskActual(task.id);
  return `<div class="current-task"><span class="current-task__label">Focusing on</span>
    <button type="button" class="current-task__title" data-action="task-open" data-id="${esc(task.id)}">${esc(task.title)}</button>
    <span class="current-task__meta">${projectChip(task.projectId)}${pips(a.pomos, task.estimate)}</span>
    <span class="current-task__actions"><button type="button" class="link-btn" data-action="pick-active-task">Change</button><button type="button" class="link-btn" data-action="task-focus-clear">Clear</button></span></div>`;
}

export function miniTimer(v = timerView()) {
  const task = v.taskId ? get('tasks', v.taskId) : null;
  return `<div class="mini-timer__inner dial--${v.mode} is-${v.status}">
    <button type="button" class="mini-timer__play" data-action="timer-toggle" aria-label="${v.status === 'running' ? 'Pause' : 'Start'} timer">${icon(v.status === 'running' ? 'pause' : 'play', { size: 16 })}</button>
    <a class="mini-timer__text" href="#/today"><span class="mini-timer__time" data-timer-text>${fmtClock(v.remainingMs / 1000)}</span><span class="mini-timer__task">${esc(v.mode === 'focus' ? (task?.title || 'Unassigned focus') : MODE_LABEL[v.mode])}</span></a>
    <button type="button" class="icon-btn" data-action="focus-mode" aria-label="Open focus mode">${icon('expand', { size: 16 })}</button>
    <span class="mini-timer__bar"><span data-timer-bar style="width:${(v.progress * 100).toFixed(1)}%"></span></span>
  </div>`;
}

/** In-place update of every visible timer element. */
export function updateTimerDom(v = timerView()) {
  const text = fmtClock(v.remainingMs / 1000);
  for (const el of qsa('[data-timer-text]')) if (el.textContent !== text) el.textContent = text;
  const off = (C_IN * (1 - v.progress)).toFixed(2);
  for (const el of qsa('[data-dial-progress]')) el.setAttribute('stroke-dashoffset', off);
  for (const el of qsa('[data-timer-bar]')) el.style.width = `${(v.progress * 100).toFixed(1)}%`;
  const task = v.taskId ? get('tasks', v.taskId) : null;
  const base = v.status === 'idle' ? 'Winlark' : `${text} ${v.mode === 'focus' ? (task ? `— ${task.title}` : '— Focus') : `— ${MODE_LABEL[v.mode]}`}`;
  if (document.title !== base) document.title = base;
}
