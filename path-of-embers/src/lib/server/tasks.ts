import { wouldCycle } from '../graph';
import { uid } from '../format';
import { hoursLogged, isBlocked, isOverdue, isReady, taskXp } from '../selectors';
import {
  PRIORITIES,
  STATUSES,
  type Priority,
  type ProjectData,
  type Status,
  type Task,
  type UserId,
} from '../types';
import { ApiError } from './store';

/** Shapes the API accepts and returns. Kept deliberately forgiving on input. */

type Json = Record<string, unknown>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown, field: string): string {
  if (typeof v !== 'string') throw new ApiError(400, `${field} must be a string`);
  return v;
}

/** `A`/`O` are accepted because that is how the team writes them down. */
export function coerceAssignee(v: unknown, field = 'assignee'): UserId | null {
  if (v === null || v === undefined || v === '') return null;
  const s = str(v, field).trim().toLowerCase();
  if (s === 'a' || s === 'aina') return 'aina';
  if (s === 'o' || s === 'onja') return 'onja';
  throw new ApiError(400, `${field} must be one of: aina, onja, A, O, null`);
}

function coerceStatus(v: unknown): Status {
  const s = str(v, 'status').trim().toLowerCase();
  if (!(STATUSES as readonly string[]).includes(s)) {
    throw new ApiError(400, `status must be one of: ${STATUSES.join(', ')}`);
  }
  return s as Status;
}

function coercePriority(v: unknown): Priority {
  const s = str(v, 'priority').trim().toLowerCase();
  if (!(PRIORITIES as readonly string[]).includes(s)) {
    throw new ApiError(400, `priority must be one of: ${PRIORITIES.join(', ')}`);
  }
  return s as Priority;
}

function coerceNumber(v: unknown, field: string): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) throw new ApiError(400, `${field} must be a number ≥ 0`);
  return n;
}

function coerceDue(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = str(v, 'due').trim();
  if (!DATE_RE.test(s)) throw new ApiError(400, 'due must be YYYY-MM-DD or null');
  return s;
}

function coerceTags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new ApiError(400, 'tags must be an array of strings');
  return [...new Set(v.map((t) => str(t, 'tags[]').trim().toLowerCase()).filter(Boolean))];
}

/** Accepts a task id or a human key like `EMB-12`. */
export function resolveTask(project: ProjectData, ref: unknown): Task {
  const s = str(ref, 'task reference').trim();
  const byId = project.tasks[s];
  if (byId) return byId;
  const byKey = Object.values(project.tasks).find(
    (t) => t.key.toLowerCase() === s.toLowerCase(),
  );
  if (!byKey) throw new ApiError(404, `no task matches "${s}"`);
  return byKey;
}

/** Accepts a group id or its name, case-insensitively. */
export function resolveGroup(project: ProjectData, ref: unknown): string {
  const s = str(ref, 'groupId').trim();
  if (project.groups[s]) return s;
  const found = Object.values(project.groups).find(
    (c) => c.name.toLowerCase() === s.toLowerCase(),
  );
  if (!found) {
    const names = Object.values(project.groups)
      .map((c) => `${c.id} (${c.name})`)
      .join(', ');
    throw new ApiError(400, `no group matches "${s}". Known: ${names}`);
  }
  return found.id;
}

function applyStatus(task: Task, status: Status): void {
  const now = Date.now();
  task.status = status;
  if (status === 'done') {
    task.completedAt = task.completedAt ?? now;
    task.startedAt = task.startedAt ?? now;
  } else {
    task.completedAt = null;
    if (status === 'active' && !task.startedAt) task.startedAt = now;
    if (status === 'backlog' || status === 'ready') task.startedAt = null;
  }
}

/** Links `task` to each ref, rejecting unknown tasks and anything cyclic. */
export function setDeps(project: ProjectData, task: Task, refs: unknown): void {
  if (!Array.isArray(refs)) throw new ApiError(400, 'deps must be an array');
  const ids: string[] = [];
  for (const ref of refs) {
    const dep = resolveTask(project, ref);
    if (dep.id === task.id) throw new ApiError(400, 'a task cannot wait on itself');
    if (ids.includes(dep.id)) continue;
    // Check against the deps accumulated so far, not the stale list.
    task.deps = ids;
    if (wouldCycle(project.tasks, task.id, dep.id)) {
      throw new ApiError(409, `${task.key} cannot wait on ${dep.key}: that closes a loop`);
    }
    ids.push(dep.id);
  }
  task.deps = ids;
}

export function createTask(project: ProjectData, body: Json): Task {
  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw new ApiError(400, 'title is required');
  }
  const now = Date.now();
  const groupId =
    body.groupId !== undefined
      ? resolveGroup(project, body.groupId)
      : (Object.values(project.groups).sort((a, b) => a.order - b.order)[0]?.id ?? 'core');

  const task: Task = {
    id: uid('t'),
    key: `EMB-${String(project.nextKey).padStart(2, '0')}`,
    title: body.title.trim(),
    notes: body.notes === undefined ? '' : str(body.notes, 'notes'),
    status: body.status === undefined ? 'backlog' : coerceStatus(body.status),
    priority: body.priority === undefined ? 'normal' : coercePriority(body.priority),
    assignee: coerceAssignee(body.assignee ?? null),
    groupId,
    deps: [],
    tags: body.tags === undefined ? [] : coerceTags(body.tags),
    estimate: body.estimate === undefined ? 4 : coerceNumber(body.estimate, 'estimate'),
    due: coerceDue(body.due),
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    checklist: [],
    comments: [],
    logs: [],
    attachments: [],
    pos: null,
  };

  project.tasks[task.id] = task;
  project.order.push(task.id);
  project.nextKey += 1;

  if (body.status !== undefined) applyStatus(task, task.status);
  if (body.deps !== undefined) setDeps(project, task, body.deps);
  return task;
}

export function patchTask(project: ProjectData, task: Task, body: Json): Task {
  if (body.title !== undefined) {
    const t = str(body.title, 'title').trim();
    if (!t) throw new ApiError(400, 'title cannot be empty');
    task.title = t;
  }
  if (body.notes !== undefined) task.notes = str(body.notes, 'notes');
  if (body.priority !== undefined) task.priority = coercePriority(body.priority);
  if (body.assignee !== undefined) task.assignee = coerceAssignee(body.assignee);
  if (body.estimate !== undefined) task.estimate = coerceNumber(body.estimate, 'estimate');
  if (body.due !== undefined) task.due = coerceDue(body.due);
  if (body.tags !== undefined) task.tags = coerceTags(body.tags);
  if (body.groupId !== undefined) {
    task.groupId = resolveGroup(project, body.groupId);
  }
  if (body.deps !== undefined) setDeps(project, task, body.deps);
  if (body.status !== undefined) applyStatus(task, coerceStatus(body.status));
  task.updatedAt = Date.now();
  return task;
}

export function deleteTask(project: ProjectData, task: Task): void {
  delete project.tasks[task.id];
  project.order = project.order.filter((id) => id !== task.id);
  for (const other of Object.values(project.tasks)) {
    if (other.deps.includes(task.id)) {
      other.deps = other.deps.filter((d) => d !== task.id);
    }
  }
}

/** The wire shape: the stored task plus everything the graph derives from it. */
export function serialise(project: ProjectData, task: Task) {
  return {
    ...task,
    group: project.groups[task.groupId]?.name ?? null,
    blocked: isBlocked(project, task),
    ready: isReady(project, task),
    overdue: isOverdue(task),
    xp: taskXp(task),
    hoursLogged: hoursLogged(task),
    waitingOn: task.deps
      .map((d) => project.tasks[d])
      .filter((t): t is Task => Boolean(t))
      .map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status })),
    unlocks: Object.values(project.tasks)
      .filter((t) => t.deps.includes(task.id))
      .map((t) => ({ id: t.id, key: t.key, title: t.title, status: t.status })),
  };
}
