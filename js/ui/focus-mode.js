/** Distraction-free focus mode: the dial, the task, the controls — nothing else. */
import { state, get } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { todayKey } from '../utils/dates.js';
import { icon } from './icons.js';
import { dialSvg, modeTabs, controls, currentTaskLine, updateTimerDom } from './timer-ui.js';
import { timerView } from '../features/timer.js';
import { tasksOn, isOpen } from '../features/tasks.js';
import { AMBIENTS } from '../core/constants.js';
import { ambientPlaying } from '../features/audio.js';

let open = false;
let opener = null;

export function isFocusMode() { return open; }

export function renderFocusMode() {
  const el = qs('#focus-mode');
  if (!el || !open) return;
  const v = timerView();
  const next = tasksOn(todayKey()).filter((t) => isOpen(t) && t.id !== v.taskId)[0];
  const amb = state.settings.ambient;
  const playing = ambientPlaying();
  el.innerHTML = `<div class="focus-mode__inner dial--${v.mode}">
    <div class="focus-mode__top">${modeTabs(v)}<button type="button" class="btn btn--ghost focus-mode__exit" data-action="focus-mode-exit">${icon('collapse', { size: 16 })}<span>Exit</span><kbd>Esc</kbd></button></div>
    <div class="focus-mode__center">
      ${dialSvg(v, { size: Math.min(420, Math.round(Math.min(window.innerWidth, window.innerHeight) * 0.62)) })}
      ${currentTaskLine(v)}
      ${controls(v, { big: true })}
    </div>
    <div class="focus-mode__bottom">
      ${next ? `<p class="focus-mode__next"><span class="muted">Up next</span> ${esc(next.title)}</p>` : ''}
      <div class="ambient-pills" role="group" aria-label="Ambient sound">
        ${icon('headphones', { size: 16 })}
        ${AMBIENTS.map((a) => `<button type="button" class="chip-btn${amb.sound === a.id ? ' is-on' : ''}" data-action="ambient-pick" data-value="${a.id}" aria-pressed="${amb.sound === a.id}">${esc(a.label)}</button>`).join('')}
        ${amb.sound !== 'none' ? `<span class="muted ambient-state">${playing ? 'Playing' : amb.mode === 'focus' ? 'Plays during focus' : 'Paused'}</span>` : ''}
      </div>
    </div>
  </div>`;
  updateTimerDom(v);
}

export function openFocusMode() {
  const el = qs('#focus-mode');
  if (!el) return;
  opener = document.activeElement;
  open = true;
  el.hidden = false;
  document.body.classList.add('in-focus-mode');
  renderFocusMode();
  qs('[data-timer-toggle]', el)?.focus();
}

export function closeFocusMode() {
  const el = qs('#focus-mode');
  if (!el || !open) return;
  open = false;
  el.hidden = true;
  el.innerHTML = '';
  document.body.classList.remove('in-focus-mode');
  if (opener && document.contains(opener)) opener.focus();
}

export function toggleFocusMode() { if (open) closeFocusMode(); else openFocusMode(); }
