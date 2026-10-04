/** Habits — lightweight routines with a simple check-in history. */
import { state, get } from '../core/state.js';
import { esc, qs, qsa } from '../utils/dom.js';
import { todayKey, addDays, formatKey, weekdayNames } from '../utils/dates.js';
import { fmtPct, fmtDuration } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { emptyState, projectOptions, projectChip } from '../ui/components.js';
import { registerActions } from '../ui/actions.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, undoToast } from '../ui/toast.js';
import { listHabits, habitStreak, habitRate, habitHistory, toggleHabit, createHabit, updateHabit, deleteHabit, describeSchedule, isDone } from '../features/habits.js';

export const title = 'Habits';
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function habitCard(h, today) {
  const st = habitStreak(h, today);
  const rate = habitRate(h, addDays(today, -29), today);
  const hist = habitHistory(h, 28, today);
  return `<li class="habit-card card${h.active ? '' : ' is-inactive'}">
    <div class="habit-card__head">
      <button type="button" class="habit-check habit-check--big${isDone(h.id, today) ? ' is-done' : ''}" data-action="habit-toggle" data-id="${esc(h.id)}" data-date="${today}" aria-pressed="${isDone(h.id, today)}" ${h.active ? '' : 'disabled'} aria-label="${esc(h.name)} done today"><span class="habit-check__box">${icon('check', { size: 15 })}</span></button>
      <div class="habit-card__title"><h2>${esc(h.name)}</h2>
        <p class="habit-card__meta">${esc(describeSchedule(h))}${h.target ? `, ${esc(h.target)}` : ''}${h.estimateMin ? `, about ${fmtDuration(h.estimateMin)}` : ''} ${projectChip(h.projectId)}${h.active ? '' : ' <span class="status status--paused">Paused</span>'}</p></div>
      <button type="button" class="icon-btn" data-action="habit-menu" data-id="${esc(h.id)}" aria-label="Actions for ${esc(h.name)}">${icon('more')}</button>
    </div>
    <div class="habit-card__stats">
      <span>${icon('flame', { size: 14 })}<strong>${st.current}</strong> current</span>
      <span><strong>${st.longest}</strong> best</span>
      <span><strong>${rate.scheduled ? fmtPct(rate.ratio) : '—'}</strong> last 30 days</span>
    </div>
    <div class="habit-grid" role="group" aria-label="Last 28 days for ${esc(h.name)}">${hist.map((d) => `<button type="button" class="habit-day${d.done ? ' is-done' : ''}${d.scheduled ? '' : ' is-off'}${d.date === today ? ' is-today' : ''}" data-action="habit-toggle" data-id="${esc(h.id)}" data-date="${d.date}" aria-pressed="${d.done}" data-tip="${esc(`${formatKey(d.date)}\n${d.done ? 'Done' : d.scheduled ? 'Not done' : 'Not scheduled'}`)}" aria-label="${esc(formatKey(d.date))}: ${d.done ? 'done' : 'not done'}"></button>`).join('')}</div>
    ${h.description ? `<p class="muted small">${esc(h.description)}</p>` : ''}
  </li>`;
}

export function render() {
  const today = todayKey();
  const habits = listHabits();
  const active = habits.filter((h) => h.active);
  const paused = habits.filter((h) => !h.active);
  return `<div class="page page--habits">
    <header class="page-head"><div><h1 class="page-title">Habits</h1><p class="page-head__sub">Small routines, tracked separately from tasks.</p></div>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" data-action="habit-new">${icon('plus', { size: 15 })}New habit</button></div></header>
    ${habits.length ? `<ul class="habit-list">${active.map((h) => habitCard(h, today)).join('')}</ul>
      ${paused.length ? `<details class="done-group"><summary>Paused <span class="count">${paused.length}</span></summary><ul class="habit-list">${paused.map((h) => habitCard(h, today)).join('')}</ul></details>` : ''}
      <p class="muted small">Tap any day in a grid to correct its check-in. Streaks count scheduled days only; today never breaks a streak before it is over.</p>`
    : emptyState({ icon: 'leaf', title: 'No habits yet', text: 'Habits are light routines like “Read 20 pages” or “Evening walk”. They appear on Today and can power a custom streak.', action: '<button type="button" class="btn btn--primary" data-action="habit-new">Add a habit</button>' })}
  </div>`;
}

export function openHabitForm(h = null) {
  const x = h || { schedule: { type: 'daily', days: [] }, active: true };
  const names = weekdayNames(0);
  const m = openModal({
    title: h ? 'Edit habit' : 'New habit', size: 'md',
    body: `<form id="habit-form" class="form" novalidate>
      <div class="field"><label class="field__label" for="hf-name">Habit</label><input id="hf-name" name="name" class="input input--large" required maxlength="120" value="${esc(x.name || '')}" placeholder="e.g. Read 20 pages" autofocus></div>
      <fieldset class="field"><legend class="field__label">Schedule</legend>
        <label class="check-row"><input type="radio" name="type" value="daily" ${x.schedule.type === 'daily' ? 'checked' : ''}> Every day</label>
        <label class="check-row"><input type="radio" name="type" value="days" ${x.schedule.type === 'days' ? 'checked' : ''}> On specific days</label>
        <div class="repeat-days" data-days ${x.schedule.type === 'days' ? '' : 'hidden'}>${WD.map((n, i) => `<label class="day-pill"><input type="checkbox" name="days" value="${i}" ${x.schedule.days.includes(i) ? 'checked' : ''}><span title="${esc(names[i])}">${n}</span></label>`).join('')}</div></fieldset>
      <div class="form-grid">
        <div class="field"><label class="field__label" for="hf-target">Target <span class="optional">optional</span></label><input id="hf-target" name="target" class="input" maxlength="120" value="${esc(x.target || '')}" placeholder="20 pages"></div>
        <div class="field"><label class="field__label" for="hf-est">Time estimate (min)</label><input id="hf-est" name="estimateMin" type="number" min="0" max="1440" class="input" value="${x.estimateMin ?? ''}"></div>
        <div class="field"><label class="field__label" for="hf-proj">Project</label><select id="hf-proj" name="projectId" class="input">${projectOptions(x.projectId || null)}</select></div>
        <div class="field"><label class="field__label" for="hf-start">Start date</label><input id="hf-start" type="date" name="startDate" class="input" value="${esc(x.startDate || todayKey())}"></div>
      </div>
      <div class="field"><label class="field__label" for="hf-desc">Notes</label><textarea id="hf-desc" name="description" class="input" rows="2">${esc(x.description || '')}</textarea></div>
      <p class="form-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="habit-form" class="btn btn--primary">${h ? 'Save' : 'Add habit'}</button>`,
    onMount(el, close) {
      const form = qs('#habit-form', el);
      form.addEventListener('change', () => { qs('[data-days]', form).hidden = form.type.value !== 'days'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const fields = {
          name: fd.get('name'), description: fd.get('description') || '', target: fd.get('target') || '',
          estimateMin: fd.get('estimateMin') || null, projectId: fd.get('projectId') || null, startDate: fd.get('startDate') || null,
          schedule: { type: fd.get('type'), days: fd.getAll('days').map(Number) },
        };
        try {
          const rec = h ? await updateHabit(h.id, fields) : await createHabit(fields);
          close(rec);
          toast(h ? 'Habit saved.' : 'Habit added.', { tone: 'success' });
        } catch (err) { const b = qs('.form-error', el); b.textContent = err.message; b.hidden = false; }
      });
    },
  });
  return m.result;
}

registerActions({
  'habit-new': () => openHabitForm(),
  'habit-edit': (el) => openHabitForm(get('habits', el.dataset.id)),
  'habit-toggle': async (el) => {
    const date = el.dataset.date || todayKey();
    if (date > todayKey()) { toast('You can’t check in a day that hasn’t happened yet.', { tone: 'info' }); return; }
    await toggleHabit(el.dataset.id, date);
  },
  'habit-active': async (el) => { const h = get('habits', el.dataset.id); await updateHabit(h.id, { active: !h.active }); toast(h.active ? 'Habit paused. Its history is kept.' : 'Habit resumed.', { tone: 'success' }); },
  'habit-menu': async (el) => {
    const { openMenu } = await import('../ui/components.js');
    const h = get('habits', el.dataset.id);
    openMenu(el, [
      { label: 'Edit', icon: 'edit', action: 'habit-edit', data: { id: h.id } },
      { label: h.active ? 'Pause' : 'Resume', icon: h.active ? 'pause' : 'play', action: 'habit-active', data: { id: h.id } },
      { label: 'Delete', icon: 'trash', action: 'habit-delete', data: { id: h.id }, danger: true },
    ]);
  },
  'habit-delete': async (el) => {
    const h = get('habits', el.dataset.id);
    if (!await confirmDialog({ title: 'Delete habit?', danger: true, confirmLabel: 'Delete', message: `“${h.name}” and all its check-ins will be deleted. Pausing keeps the history instead.` })) return;
    const inv = await deleteHabit(h.id);
    undoToast('Habit deleted.', inv);
  },
});

export { state, qsa };
