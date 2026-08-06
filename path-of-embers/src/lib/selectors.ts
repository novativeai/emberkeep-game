import { DAY_MS, dayKey, parseDay, todayKey } from './format';
import type { Filters, Priority, ProjectData, Status, Task, UserId } from './types';

/** Derived reads over ProjectData. Nothing here mutates; everything is cheap. */

const PRIORITY_XP: Record<Priority, number> = {
  low: 0.8,
  normal: 1,
  high: 1.35,
  critical: 1.8,
};

/** XP is earned, not awarded: it scales with the size and the stakes of a task. */
export function taskXp(t: Task): number {
  return Math.max(5, Math.round(t.estimate * PRIORITY_XP[t.priority] * 10));
}

/** XP thresholds. Levels are plain numbers — this is a progress bar, not lore. */
export const RANKS: readonly { at: number; name: string }[] = [
  { at: 0, name: 'Level 1' },
  { at: 100, name: 'Level 2' },
  { at: 250, name: 'Level 3' },
  { at: 450, name: 'Level 4' },
  { at: 700, name: 'Level 5' },
  { at: 1000, name: 'Level 6' },
  { at: 1400, name: 'Level 7' },
  { at: 1900, name: 'Level 8' },
];

export interface Rank {
  level: number;
  name: string;
  xp: number;
  into: number;
  span: number;
  next: string | null;
  progress: number;
}

export function rankFor(xp: number): Rank {
  let i = 0;
  while (i + 1 < RANKS.length && xp >= RANKS[i + 1]!.at) i += 1;
  const cur = RANKS[i]!;
  const nxt = RANKS[i + 1];
  const span = nxt ? nxt.at - cur.at : 1;
  const into = xp - cur.at;
  return {
    level: i + 1,
    name: cur.name,
    xp,
    into,
    span,
    next: nxt?.name ?? null,
    progress: nxt ? Math.min(1, into / span) : 1,
  };
}

/** A task is blocked when any dependency is still unfinished. Never stored. */
export function isBlocked(data: ProjectData, t: Task): boolean {
  return t.status !== 'done' && t.deps.some((d) => data.tasks[d] && data.tasks[d]!.status !== 'done');
}

/** Ready right now: not done, and nothing upstream is outstanding. */
export function isReady(data: ProjectData, t: Task): boolean {
  return t.status !== 'done' && !isBlocked(data, t);
}

export function isOverdue(t: Task, now = Date.now()): boolean {
  return t.status !== 'done' && t.due !== null && parseDay(t.due) < parseDay(dayKey(now));
}

export function hoursLogged(t: Task): number {
  return t.logs.reduce((a, l) => a + l.minutes, 0) / 60;
}

export function allTasks(data: ProjectData): Task[] {
  return data.order.map((id) => data.tasks[id]).filter((t): t is Task => Boolean(t));
}

export function allTags(data: ProjectData): string[] {
  const set = new Set<string>();
  for (const t of allTasks(data)) for (const tag of t.tags) set.add(tag);
  return [...set].sort();
}

export function matchesFilters(
  data: ProjectData,
  t: Task,
  f: Filters,
  search: string,
): boolean {
  if (f.assignee === 'unassigned' ? t.assignee !== null : f.assignee !== 'all' && t.assignee !== f.assignee) {
    return false;
  }
  if (f.status !== 'all' && t.status !== f.status) return false;
  if (f.priority !== 'all' && t.priority !== f.priority) return false;
  if (f.groupId !== 'all' && t.groupId !== f.groupId) return false;
  if (f.tag !== 'all' && !t.tags.includes(f.tag)) return false;
  if (f.readyOnly && !isReady(data, t)) return false;
  if (f.blockedOnly && !isBlocked(data, t)) return false;
  if (f.overdueOnly && !isOverdue(t)) return false;
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    const hay = `${t.key} ${t.title} ${t.notes} ${t.tags.join(' ')}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

export function filterTasks(data: ProjectData, f: Filters, search: string): Task[] {
  return allTasks(data).filter((t) => matchesFilters(data, t, f, search));
}

export interface UserStats {
  id: UserId;
  done: number;
  open: number;
  active: number;
  blocked: number;
  overdue: number;
  xp: number;
  rank: Rank;
  hours: number;
  estimateOpen: number;
  streak: number;
  bestStreak: number;
  completedToday: number;
}

export function userStats(data: ProjectData, id: UserId): UserStats {
  const mine = allTasks(data).filter((t) => t.assignee === id);
  const done = mine.filter((t) => t.status === 'done');
  const xp = done.reduce((a, t) => a + taskXp(t), 0);
  const days = new Set(done.map((t) => dayKey(t.completedAt ?? t.updatedAt)));

  let streak = 0;
  const today = todayKey();
  let cursor = days.has(today) ? parseDay(today) : parseDay(today) - DAY_MS;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor -= DAY_MS;
  }

  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev: number | null = null;
  for (const d of sorted) {
    const ts = parseDay(d);
    run = prev !== null && ts - prev === DAY_MS ? run + 1 : 1;
    prev = ts;
    best = Math.max(best, run);
  }

  return {
    id,
    done: done.length,
    open: mine.length - done.length,
    active: mine.filter((t) => t.status === 'active').length,
    blocked: mine.filter((t) => isBlocked(data, t)).length,
    overdue: mine.filter((t) => isOverdue(t)).length,
    xp,
    rank: rankFor(xp),
    hours: mine.reduce((a, t) => a + hoursLogged(t), 0),
    estimateOpen: mine.filter((t) => t.status !== 'done').reduce((a, t) => a + t.estimate, 0),
    streak,
    bestStreak: best,
    completedToday: done.filter((t) => dayKey(t.completedAt ?? 0) === today).length,
  };
}

export interface ProjectStats {
  total: number;
  done: number;
  open: number;
  blocked: number;
  ready: number;
  overdue: number;
  estimateTotal: number;
  estimateDone: number;
  hoursLogged: number;
  byStatus: Record<Status, number>;
  byPriority: Record<Priority, number>;
  byGroup: { id: string; name: string; done: number; total: number; hours: number }[];
  velocity: { week: string; count: number; hours: number }[];
  burndown: { day: string; remaining: number }[];
  tagCloud: { tag: string; count: number }[];
}

export function projectStats(data: ProjectData, now = Date.now()): ProjectStats {
  const tasks = allTasks(data);
  const byStatus = { backlog: 0, ready: 0, active: 0, review: 0, done: 0 } as Record<Status, number>;
  const byPriority = { low: 0, normal: 0, high: 0, critical: 0 } as Record<Priority, number>;
  for (const t of tasks) {
    byStatus[t.status] += 1;
    byPriority[t.priority] += 1;
  }

  const byGroup = Object.values(data.groups)
    .sort((a, b) => a.order - b.order)
    .map((c) => {
      const inC = tasks.filter((t) => t.groupId === c.id);
      return {
        id: c.id,
        name: c.name,
        done: inC.filter((t) => t.status === 'done').length,
        total: inC.length,
        hours: inC.reduce((a, t) => a + hoursLogged(t), 0),
      };
    });

  const velocity: { week: string; count: number; hours: number }[] = [];
  for (let w = 7; w >= 0; w -= 1) {
    const end = now - w * 7 * DAY_MS;
    const start = end - 7 * DAY_MS;
    const inWeek = tasks.filter(
      (t) => t.completedAt !== null && t.completedAt > start && t.completedAt <= end,
    );
    velocity.push({
      week: dayKey(end).slice(5),
      count: inWeek.length,
      hours: inWeek.reduce((a, t) => a + t.estimate, 0),
    });
  }

  const burndown: { day: string; remaining: number }[] = [];
  for (let d = 29; d >= 0; d -= 1) {
    const at = now - d * DAY_MS;
    const remaining = tasks
      .filter((t) => t.createdAt <= at && !(t.completedAt !== null && t.completedAt <= at))
      .reduce((a, t) => a + t.estimate, 0);
    burndown.push({ day: dayKey(at).slice(5), remaining });
  }

  const tagCount = new Map<string, number>();
  for (const t of tasks) for (const tag of t.tags) tagCount.set(tag, (tagCount.get(tag) ?? 0) + 1);

  return {
    total: tasks.length,
    done: byStatus.done,
    open: tasks.length - byStatus.done,
    blocked: tasks.filter((t) => isBlocked(data, t)).length,
    ready: tasks.filter((t) => isReady(data, t)).length,
    overdue: tasks.filter((t) => isOverdue(t, now)).length,
    estimateTotal: tasks.reduce((a, t) => a + t.estimate, 0),
    estimateDone: tasks.filter((t) => t.status === 'done').reduce((a, t) => a + t.estimate, 0),
    hoursLogged: tasks.reduce((a, t) => a + hoursLogged(t), 0),
    byStatus,
    byPriority,
    byGroup,
    velocity,
    burndown,
    tagCloud: [...tagCount.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count),
  };
}

/**
 * Freeing a task unblocks whatever was waiting only on it — worth surfacing,
 * because that is the moment the graph opens up.
 */
export function unlockedBy(data: ProjectData, id: string): Task[] {
  return allTasks(data).filter(
    (t) =>
      t.status !== 'done' &&
      t.deps.includes(id) &&
      t.deps.every((d) => d === id || !data.tasks[d] || data.tasks[d]!.status === 'done'),
  );
}
