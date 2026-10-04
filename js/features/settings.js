/** Settings: one validated record, deep-merged over defaults. */
import { state, commit, mergeSettings } from '../core/state.js';
import { THEMES, ALARMS, AMBIENTS } from '../core/constants.js';
import { int, bool, oneOf } from '../utils/validation.js';

export function getSettings() { return state.settings; }

/** Pomodoro focus target in minutes (explicit value or goal × length). */
export function focusTargetMinutes(s = state.settings) {
  if (s.goals.focusTargetMin) return s.goals.focusTargetMin;
  return (s.goals.dailyPomos || 0) * s.timer.focusMin || 240;
}

/** Validate a partial settings patch, e.g. { timer: { focusMin: 30 } }. */
export function sanitizePatch(patch) {
  const out = {};
  if (patch.timer) {
    const t = patch.timer; const o = {};
    if ('focusMin' in t) o.focusMin = int(t.focusMin, { min: 1, max: 180, required: true, field: 'Focus length' });
    if ('shortMin' in t) o.shortMin = int(t.shortMin, { min: 1, max: 120, required: true, field: 'Short break' });
    if ('longMin' in t) o.longMin = int(t.longMin, { min: 1, max: 180, required: true, field: 'Long break' });
    if ('longEvery' in t) o.longEvery = int(t.longEvery, { min: 1, max: 12, required: true, field: 'Long break interval' });
    if ('autoStartBreak' in t) o.autoStartBreak = bool(t.autoStartBreak);
    if ('autoStartFocus' in t) o.autoStartFocus = bool(t.autoStartFocus);
    out.timer = o;
  }
  if (patch.goals) {
    const g = patch.goals; const o = {};
    if ('dailyPomos' in g) o.dailyPomos = int(g.dailyPomos, { min: 0, max: 50, fallback: 0, field: 'Daily goal' });
    if ('focusTargetMin' in g) o.focusTargetMin = int(g.focusTargetMin, { min: 0, max: 1440, fallback: null, field: 'Focus target' }) || null;
    if ('workloadLightPct' in g) o.workloadLightPct = int(g.workloadLightPct, { min: 10, max: 200, required: true, field: 'Light threshold' });
    if ('workloadHeavyPct' in g) o.workloadHeavyPct = int(g.workloadHeavyPct, { min: 20, max: 400, required: true, field: 'Heavy threshold' });
    out.goals = o;
  }
  if (patch.notifications) out.notifications = { enabled: bool(patch.notifications.enabled) };
  if (patch.sound) {
    const s = patch.sound; const o = {};
    if ('alarm' in s) o.alarm = oneOf(s.alarm, ALARMS.map((a) => a.id), 'bell');
    if ('volume' in s) o.volume = int(s.volume, { min: 0, max: 100, required: true, field: 'Volume' });
    if ('tick' in s) o.tick = bool(s.tick);
    out.sound = o;
  }
  if (patch.ambient) {
    const a = patch.ambient; const o = {};
    if ('sound' in a) o.sound = oneOf(a.sound, ['none', ...AMBIENTS.map((x) => x.id)], 'none');
    if ('volume' in a) o.volume = int(a.volume, { min: 0, max: 100, required: true, field: 'Ambient volume' });
    if ('mode' in a) o.mode = oneOf(a.mode, ['focus', 'always'], 'focus');
    out.ambient = o;
  }
  if (patch.appearance) {
    const a = patch.appearance; const o = {};
    if ('theme' in a) o.theme = oneOf(a.theme, THEMES.map((t) => t.id), 'night');
    if ('motion' in a) o.motion = oneOf(a.motion, ['system', 'reduce', 'full'], 'system');
    out.appearance = o;
  }
  if (patch.general) {
    const g = patch.general; const o = {};
    if ('weekStart' in g) o.weekStart = int(g.weekStart, { min: 0, max: 6, fallback: 1 });
    out.general = o;
  }
  return out;
}

export async function updateSettings(patch) {
  const clean = sanitizePatch(patch);
  const next = structuredClone(state.settings);
  for (const [group, values] of Object.entries(clean)) next[group] = { ...next[group], ...values };
  if (next.goals.workloadHeavyPct <= next.goals.workloadLightPct) {
    next.goals.workloadHeavyPct = next.goals.workloadLightPct + 10;
  }
  next.updatedAt = Date.now();
  await commit({ put: { settings: [mergeSettings(next)] } });
  return state.settings;
}
