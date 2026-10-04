/** Domain constants shared by every layer. */

export const APP_NAME = 'Winlark';
// Backups written before the rename say "PomoFocus"; they must keep importing.
export const LEGACY_APP_NAMES = ['PomoFocus'];
export const APP_VERSION = '2.0.0';

/** Version of the exported JSON format. v1 = the legacy single-file app. */
export const DATA_SCHEMA_VERSION = 2;

/** IndexedDB database version. Bump and add a step in db.js UPGRADES to evolve. */
export const DB_NAME = 'pomofocus';
export const DB_VERSION = 1;

export const LEGACY_STORAGE_KEY = 'pomofocus_data';

/**
 * Collections. `key` is the keyPath; every record carries `id`.
 * Indexes exist so a future server-backed repository (or larger datasets)
 * can query by these fields without a full scan.
 */
export const STORES = {
  settings: { indexes: [] },
  meta: { indexes: [] },
  projects: { indexes: ['archived'] },
  objectives: { indexes: ['projectId', 'status'] },
  tasks: { indexes: ['plannedDate', 'status', 'projectId', 'objectiveId', 'seriesId'] },
  dailyPlans: { indexes: [] },
  habits: { indexes: [] },
  habitCompletions: { indexes: ['habitId', 'date'] },
  sessions: { indexes: ['date', 'taskId', 'type'] },
  streaks: { indexes: [] },
  reviews: { indexes: [] },
  activity: { indexes: ['date', 'taskId'] },
  snapshots: { indexes: [] },
};

/** Collections that make up a backup (snapshots and meta are excluded). */
export const DATA_COLLECTIONS = [
  'projects', 'objectives', 'tasks', 'dailyPlans', 'habits', 'habitCompletions',
  'sessions', 'streaks', 'reviews', 'activity',
];

export const TASK_KIND = { SINGLE: 'single', SERIES: 'series', OCCURRENCE: 'occurrence' };

/** Task lifecycle. Series (recurring templates) use 'active' | 'archived'. */
export const TASK_STATUS = {
  INBOX: 'inbox',
  PLANNED: 'planned',
  IN_PROGRESS: 'in-progress',
  COMPLETED: 'completed',
  ARCHIVED: 'archived',
  ACTIVE: 'active',
};
export const OPEN_STATUSES = new Set(['inbox', 'planned', 'in-progress']);

export const PRIORITIES = ['high', 'med', 'low'];
export const PRIORITY_RANK = { high: 0, med: 1, low: 2 };

export const OBJECTIVE_STATUS = ['active', 'paused', 'completed', 'archived'];

export const SESSION_TYPES = ['focus', 'shortBreak', 'longBreak'];
export const SESSION_SOURCE = { TIMER: 'timer', MANUAL: 'manual', LEGACY: 'legacy' };

export const TIMER_MODES = {
  focus: { label: 'Focus', settingKey: 'focusMin' },
  shortBreak: { label: 'Short break', settingKey: 'shortMin' },
  longBreak: { label: 'Long break', settingKey: 'longMin' },
};

export const RECURRENCE_FREQ = ['daily', 'weekdays', 'weekly', 'interval'];

export const STREAK_METRICS = {
  pomodoros: { label: 'Pomodoros completed', unit: 'Pomodoros', needsThreshold: true },
  focusMinutes: { label: 'Focus minutes', unit: 'minutes', needsThreshold: true },
  tasksCompleted: { label: 'Tasks completed', unit: 'tasks', needsThreshold: true },
  objectivePct: { label: 'Objective completion %', unit: '%', needsThreshold: true },
  dayWin: { label: 'Day Win completed', unit: '', needsThreshold: false },
  habit: { label: 'A habit completed', unit: '', needsThreshold: false, needsHabits: 'one' },
  habitGroup: { label: 'A group of habits completed', unit: '', needsThreshold: false, needsHabits: 'many' },
};

export const PROJECT_COLORS = [
  '#e94560', '#27ae60', '#2980b9', '#9b59b6', '#e67e22', '#1abc9c', '#e91e8c', '#f39c12',
  '#64748b', '#0ea5e9',
];

/**
 * Themes. `legacyIndex` maps the v1 numeric theme setting.
 * The visual definition of each theme lives in css/themes.css.
 */
export const THEMES = [
  { id: 'night', name: 'Night', legacyIndex: 0, swatch: ['#181a2a', '#f25f5c'] },
  { id: 'forest', name: 'Forest', legacyIndex: 1, swatch: ['#0f1a14', '#5cc48a'] },
  { id: 'ocean', name: 'Ocean', legacyIndex: 2, swatch: ['#0b1b2b', '#4fb3e8'] },
  { id: 'dusk', name: 'Dusk', legacyIndex: 3, swatch: ['#1b1426', '#b892ff'] },
  { id: 'ember', name: 'Ember', legacyIndex: 4, swatch: ['#1c130d', '#f2994a'] },
  { id: 'slate', name: 'Slate', legacyIndex: 5, swatch: ['#0f1720', '#38bdf8'] },
  { id: 'rose', name: 'Rose', legacyIndex: 6, swatch: ['#1e1117', '#f06292'] },
  { id: 'mono', name: 'Mono', legacyIndex: 7, swatch: ['#161616', '#e6e6e6'] },
  { id: 'paper', name: 'Paper', legacyIndex: null, swatch: ['#f3f5f8', '#2f5bea'] },
  { id: 'aurora', name: 'Aurora', legacyIndex: null, swatch: ['#0a1620', '#6ee7b7'] },
];

export const ALARMS = [
  { id: 'bell', label: 'Bell' },
  { id: 'digital', label: 'Digital' },
  { id: 'chime', label: 'Chime' },
  { id: 'none', label: 'None' },
];

export const AMBIENTS = [
  { id: 'rain', label: 'Rain' },
  { id: 'white', label: 'White noise' },
  { id: 'brown', label: 'Brown noise' },
  { id: 'cafe', label: 'Café' },
  { id: 'fire', label: 'Fireplace' },
  { id: 'waves', label: 'Ocean waves' },
];

export const DEFAULT_SETTINGS = Object.freeze({
  id: 'app',
  timer: { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoStartBreak: false, autoStartFocus: false },
  goals: { dailyPomos: 8, focusTargetMin: null, workloadLightPct: 75, workloadHeavyPct: 110 },
  notifications: { enabled: false },
  sound: { alarm: 'bell', volume: 80, tick: false },
  ambient: { sound: 'none', volume: 45, mode: 'focus' },
  appearance: { theme: 'night', motion: 'system' },
  general: { weekStart: 1 },
});

export const ROUTES = [
  { id: 'today', label: 'Today', icon: 'sun', key: 't' },
  { id: 'plan', label: 'Plan', icon: 'plan', key: 'p' },
  { id: 'tasks', label: 'Tasks', icon: 'list', key: 'k' },
  { id: 'objectives', label: 'Objectives', icon: 'target', key: 'o' },
  { id: 'habits', label: 'Habits', icon: 'leaf', key: 'h' },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', key: 'c' },
  { id: 'analytics', label: 'Analytics', icon: 'chart', key: 'a' },
  { id: 'projects', label: 'Projects', icon: 'folder', key: 'j' },
  { id: 'history', label: 'History', icon: 'clock', key: 'y' },
  { id: 'settings', label: 'Settings', icon: 'gear', key: ',' },
];
