/** Projects — an organisational layer above objectives and tasks. IDs are never reused. */
import { state, all, get, commit } from '../core/state.js';
import { normalizeProject } from '../utils/validation.js';
import { newId } from '../utils/ids.js';
import { PROJECT_COLORS } from '../core/constants.js';

export function listProjects({ includeArchived = false } = {}) {
  return all('projects')
    .filter((p) => includeArchived || !p.archived)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name));
}

export function projectById(id) { return get('projects', id); }

export function nextProjectColor() {
  const used = new Set(all('projects').map((p) => p.color));
  return PROJECT_COLORS.find((c) => !used.has(c)) || PROJECT_COLORS[all('projects').length % PROJECT_COLORS.length];
}

export async function createProject({ name, color, description }) {
  const now = Date.now();
  const maxOrder = Math.max(0, ...all('projects').map((p) => p.order ?? 0));
  const rec = normalizeProject({ id: newId('p'), name, color: color || nextProjectColor(), description, order: maxOrder + 1024, createdAt: now, updatedAt: now });
  await commit({ put: { projects: [rec] } });
  return rec;
}

export async function updateProject(id, patch) {
  const cur = get('projects', id);
  if (!cur) throw new Error('Project not found');
  const rec = normalizeProject({ ...cur, ...patch, id, updatedAt: Date.now() });
  await commit({ put: { projects: [rec] } });
  return rec;
}

export async function setProjectArchived(id, archived) {
  return updateProject(id, { archived });
}

/** Usage counts shown before deleting. */
export function projectUsage(id) {
  return {
    tasks: all('tasks').filter((t) => t.projectId === id).length,
    objectives: all('objectives').filter((o) => o.projectId === id).length,
    habits: all('habits').filter((h) => h.projectId === id).length,
    sessions: all('sessions').filter((s) => s.projectId === id).length,
  };
}

/**
 * Delete a project. Linked records are kept and simply lose the link.
 * Returns the inverse change set so the caller can offer Undo.
 */
export async function deleteProject(id) {
  const now = Date.now();
  const unlink = (store) => all(store).filter((r) => r.projectId === id).map((r) => ({ ...r, projectId: null, updatedAt: now }));
  return commit({
    put: { tasks: unlink('tasks'), objectives: unlink('objectives'), habits: unlink('habits'), sessions: unlink('sessions') },
    del: { projects: [id] },
  });
}

export function projectName(id) {
  return state.projects.get(id)?.name ?? null;
}
