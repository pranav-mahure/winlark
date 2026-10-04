/** Projects — the organisational layer above objectives and tasks. */
import { state, get, all } from '../core/state.js';
import { esc, qs } from '../utils/dom.js';
import { formatKey, todayKey } from '../utils/dates.js';
import { fmtDuration, fmtPct, plural, fmtSigned } from '../utils/format.js';
import { icon } from '../ui/icons.js';
import { taskRow, emptyState, sectionHead, stat, progressBar, segmented } from '../ui/components.js';
import { chart } from '../ui/charts.js';
import { registerActions } from '../ui/actions.js';
import { navigate, setQuery } from '../ui/router.js';
import { openModal, confirmDialog } from '../ui/modals.js';
import { toast, undoToast } from '../ui/toast.js';
import { listProjects, createProject, updateProject, setProjectArchived, deleteProject, projectUsage, nextProjectColor } from '../features/projects.js';
import { projectStats } from '../features/analytics.js';
import { objectiveProgress } from '../features/objectives.js';
import { isOpen } from '../features/tasks.js';
import { PROJECT_COLORS } from '../core/constants.js';
import { quickAddForm } from './today.js';

export const title = 'Projects';

function card(p) {
  const s = projectStats(p.id);
  return `<li><a class="project-card card${p.archived ? ' is-archived' : ''}" href="#/projects/${esc(p.id)}" style="--chip:${esc(p.color)}">
    <span class="project-card__bar"></span>
    <span class="project-card__name">${esc(p.name)}${p.archived ? ' <span class="status status--archived">Archived</span>' : ''}</span>
    ${p.description ? `<span class="project-card__desc">${esc(p.description)}</span>` : ''}
    <span class="project-card__stats"><span><strong>${fmtDuration(s.focusMin, { compact: true })}</strong> focus</span><span><strong>${s.pomos}</strong> Pomodoros</span><span><strong>${s.activeTasks}</strong> open tasks</span></span>
    <span class="project-card__foot">${s.lastDate ? `Last focus ${esc(formatKey(s.lastDate, { month: 'short', day: 'numeric', year: s.lastDate.slice(0, 4) === todayKey().slice(0, 4) ? undefined : 'numeric' }))}` : 'No focus yet'}${s.objectives.length ? `, ${plural(s.objectives.length, 'objective')}` : ''}</span>
  </a></li>`;
}

function listView(q) {
  const show = q.show === 'archived' ? 'archived' : 'active';
  const list = listProjects({ includeArchived: true }).filter((p) => (show === 'archived' ? p.archived : !p.archived));
  return `<div class="page page--projects">
    <header class="page-head"><div><h1 class="page-title">Projects</h1><p class="page-head__sub">Group objectives, tasks and focus time by area of work or life.</p></div>
      <div class="page-head__actions"><button type="button" class="btn btn--primary" data-action="project-new">${icon('plus', { size: 15 })}New project</button></div></header>
    ${segmented([{ value: 'active', label: 'Active' }, { value: 'archived', label: `Archived (${all('projects').filter((p) => p.archived).length})` }], show, { action: 'projects-show', label: 'Show' })}
    ${list.length ? `<ul class="project-grid">${list.map(card).join('')}</ul>`
    : emptyState({ icon: 'folder', title: show === 'archived' ? 'No archived projects' : 'No projects yet', text: show === 'archived' ? '' : 'Projects like “Work”, “Study” or “Side project” let you see where your focus goes.', action: show === 'archived' ? '' : '<button type="button" class="btn btn--primary" data-action="project-new">Create a project</button>' })}
  </div>`;
}

function detailView(p) {
  const s = projectStats(p.id);
  const tasks = all('tasks').filter((t) => t.projectId === p.id && t.kind !== 'series');
  const open = tasks.filter(isOpen).sort((a, b) => (a.plannedDate || '9999').localeCompare(b.plannedDate || '9999'));
  const done = tasks.filter((t) => t.status === 'completed').sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const usage = projectUsage(p.id);
  return `<div class="page page--project" style="--chip:${esc(p.color)}">
    <nav class="breadcrumb"><a href="#/projects">${icon('chevLeft', { size: 14 })}Projects</a></nav>
    <header class="page-head"><div><h1 class="page-title"><span class="title-dot"></span>${esc(p.name)}</h1>${p.description ? `<p class="page-head__sub">${esc(p.description)}</p>` : ''}</div>
      <div class="page-head__actions"><button type="button" class="btn btn--secondary" data-action="project-edit" data-id="${esc(p.id)}">${icon('edit', { size: 15 })}Edit</button>
        <button type="button" class="btn btn--ghost" data-action="project-archive" data-id="${esc(p.id)}">${icon('archive', { size: 15 })}${p.archived ? 'Unarchive' : 'Archive'}</button>
        <button type="button" class="icon-btn" data-action="project-delete" data-id="${esc(p.id)}" aria-label="Delete project">${icon('trash')}</button></div></header>
    <div class="stat-row">
      ${stat({ label: 'Focus time', value: fmtDuration(s.focusMin) })}
      ${stat({ label: 'Pomodoros', value: String(s.pomos) })}
      ${stat({ label: 'Tasks', value: `${s.completedTasks}<small>/${s.totalTasks}</small>`, sub: `${s.activeTasks} open` })}
      ${s.pva.count ? stat({ label: 'Estimate accuracy', value: fmtPct(s.pva.ratio), sub: `actual ÷ planned, ${s.pva.count} tasks (${fmtSigned(s.pva.variance)})` }) : stat({ label: 'Estimated', value: String(s.estimatedPomos), sub: 'Pomodoros on all tasks' })}
      ${stat({ label: 'Last active', value: s.lastDate ? formatKey(s.lastDate, { month: 'short', day: 'numeric' }) : '—', sub: s.daysSinceActive != null ? (s.daysSinceActive === 0 ? 'today' : `${s.daysSinceActive} days ago`) : '' })}
    </div>
    <section class="card">${sectionHead('Last 12 weeks', { level: 2 })}
      ${chart({ type: 'bar', height: 180, label: 'Weekly focus for this project', labels: s.weeks.map((w) => formatKey(w.start, { month: 'short', day: 'numeric' })), series: [{ name: 'Focus', values: s.weeks.map((w) => w.focusMin), color: p.color }], yFormat: (v) => fmtDuration(v, { compact: true }), yUnit: 'minutes', tip: (i) => `Week of ${formatKey(s.weeks[i].start)}\n${fmtDuration(s.weeks[i].focusMin)}, ${s.weeks[i].pomos} Pomodoros`, table: { head: ['Week', 'Focus', 'Pomodoros'], rows: s.weeks.map((w) => [w.start, fmtDuration(w.focusMin), String(w.pomos)]) } })}
    </section>
    <div class="two-col">
      <section class="card">${sectionHead('Open tasks', { level: 2, count: open.length })}
        ${quickAddForm(null, { placeholder: 'Add a task to this project (@today to plan it)…', projectId: p.id })}
        ${open.length ? `<ul class="task-list">${open.slice(0, 50).map((t) => taskRow(t, { showDate: true, allowWin: false })).join('')}</ul>` : '<p class="muted">No open tasks.</p>'}
        ${done.length ? `<details class="done-group"><summary>Completed <span class="count">${done.length}</span></summary><ul class="task-list">${done.slice(0, 50).map((t) => taskRow(t, { showDate: true, allowWin: false })).join('')}</ul></details>` : ''}
      </section>
      <div>
        <section class="card">${sectionHead('Objectives', { level: 2, count: s.objectives.length, actions: '<button type="button" class="link-btn" data-action="objective-new">New</button>' })}
          ${s.objectives.length ? `<ul class="objective-mini">${s.objectives.map((o) => { const op = objectiveProgress(o.id); return `<li><a class="objective-mini__title" href="#/objectives/${esc(o.id)}">${esc(o.title)}</a>${progressBar(op.ratio, { size: 'sm', tone: 'secondary', label: o.title })}<span class="objective-mini__meta">${op.done}/${op.total} tasks, ${o.status}</span></li>`; }).join('')}</ul>` : '<p class="muted">No objectives in this project.</p>'}
        </section>
        <section class="card">${sectionHead('Recent focus', { level: 2 })}
          ${s.recent.length ? `<ul class="session-list">${s.recent.map((x) => `<li class="session-item"><span class="session-item__date">${esc(formatKey(x.date, { month: 'short', day: 'numeric' }))}</span><span>${esc(x.taskId ? get('tasks', x.taskId)?.title || 'Deleted task' : 'Unassigned')}</span><span></span><span class="session-item__dur">${fmtDuration((x.actualDuration || 0) / 60)}</span></li>`).join('')}</ul><a class="link-btn" href="#/history?project=${esc(p.id)}">All sessions</a>` : '<p class="muted">No focus sessions yet.</p>'}
        </section>
        <p class="muted small">Linked: ${usage.tasks} tasks, ${usage.objectives} objectives, ${usage.habits} habits, ${usage.sessions} sessions.</p>
      </div>
    </div>
  </div>`;
}

export function render(route) {
  if (route.parts[0]) {
    const p = get('projects', route.parts[0]);
    return p ? detailView(p) : `<div class="page">${emptyState({ icon: 'folder', title: 'Project not found', action: '<a class="btn btn--secondary" href="#/projects">All projects</a>' })}</div>`;
  }
  return listView(route.query);
}

export function openProjectForm(p = null) {
  const x = p || { color: nextProjectColor() };
  const m = openModal({
    title: p ? 'Edit project' : 'New project', size: 'sm',
    body: `<form id="project-form" class="form" novalidate>
      <div class="field"><label class="field__label" for="pf-name">Name</label><input id="pf-name" name="name" class="input" required maxlength="80" value="${esc(x.name || '')}" autofocus></div>
      <fieldset class="field"><legend class="field__label">Colour</legend><div class="swatches">${PROJECT_COLORS.map((c) => `<label class="swatch" style="--sw:${c}"><input type="radio" name="color" value="${c}" ${c === x.color ? 'checked' : ''}><span class="sr-only">${c}</span></label>`).join('')}
        <label class="swatch swatch--custom" title="Custom colour"><input type="color" name="customColor" value="${esc(x.color)}" aria-label="Custom colour"></label></div></fieldset>
      <div class="field"><label class="field__label" for="pf-desc">Description <span class="optional">optional</span></label><textarea id="pf-desc" name="description" class="input" rows="2">${esc(x.description || '')}</textarea></div>
      <p class="form-error" role="alert" hidden></p></form>`,
    footer: `<button type="button" class="btn btn--ghost" data-modal-dismiss>Cancel</button><button type="submit" form="project-form" class="btn btn--primary">${p ? 'Save' : 'Create'}</button>`,
    onMount(el, close) {
      const form = qs('#project-form', el);
      form.customColor.addEventListener('input', () => { for (const r of form.querySelectorAll('[name="color"]')) r.checked = false; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const color = fd.get('color') || fd.get('customColor');
        try {
          const rec = p ? await updateProject(p.id, { name: fd.get('name'), color, description: fd.get('description') })
            : await createProject({ name: fd.get('name'), color, description: fd.get('description') });
          close(rec); toast(p ? 'Project saved.' : `Project “${rec.name}” created.`, { tone: 'success' });
        } catch (err) { const b = qs('.form-error', el); b.textContent = err.message; b.hidden = false; }
      });
    },
  });
  return m.result;
}

registerActions({
  'project-new': () => openProjectForm(),
  'project-edit': (el) => openProjectForm(get('projects', el.dataset.id)),
  'projects-show': (el) => setQuery({ show: el.dataset.value === 'archived' ? 'archived' : null }),
  'project-archive': async (el) => { const p = get('projects', el.dataset.id); await setProjectArchived(p.id, !p.archived); toast(p.archived ? 'Project restored.' : 'Project archived. Its history stays in analytics.', { tone: 'success' }); },
  'project-delete': async (el) => {
    const p = get('projects', el.dataset.id);
    const u = projectUsage(p.id);
    const linked = u.tasks + u.objectives + u.habits + u.sessions;
    if (!await confirmDialog({ title: `Delete “${p.name}”?`, danger: true, confirmLabel: 'Delete project', message: linked ? `${u.tasks} tasks, ${u.objectives} objectives, ${u.habits} habits and ${u.sessions} sessions are linked. They will be kept, just without a project. Archiving keeps the link instead.` : 'This project has nothing linked to it.' })) return;
    const inv = await deleteProject(p.id);
    navigate('#/projects');
    undoToast('Project deleted.', inv);
  },
});

export { state };
