import { allTasks, hoursLogged, isBlocked, projectStats, userStats } from './selectors';
import type { ProjectData, UserId } from './types';

/** Achievements: derived on read, so they can never be stale or faked. */

export interface Achievement {
  id: string;
  name: string;
  blurb: string;
  earned: boolean;
  /** 0..1 — lets a locked achievement still show how close it is. */
  progress: number;
  detail: string;
}

export function achievementsFor(data: ProjectData, user: UserId): Achievement[] {
  const me = userStats(data, user);
  const stats = projectStats(data);
  const tasks = allTasks(data);
  const mine = tasks.filter((t) => t.assignee === user);
  const myDone = mine.filter((t) => t.status === 'done');
  const criticalDone = myDone.filter((t) => t.priority === 'critical').length;
  const unblockedByMe = myDone.filter((t) => tasks.some((o) => o.deps.includes(t.id))).length;
  const bigDone = myDone.filter((t) => t.estimate >= 12).length;
  const loggedHours = mine.reduce((a, t) => a + hoursLogged(t), 0);
  const noneBlocked = mine.length > 0 && mine.every((t) => !isBlocked(data, t));
  const groupsTouched = new Set(myDone.map((t) => t.groupId)).size;

  const make = (
    id: string,
    name: string,
    blurb: string,
    have: number,
    need: number,
    unit: string,
  ): Achievement => ({
    id,
    name,
    blurb,
    earned: have >= need,
    progress: Math.max(0, Math.min(1, have / need)),
    detail: `${Math.min(have, need)} / ${need} ${unit}`,
  });

  return [
    make('first', 'First task', 'Complete your first task.', myDone.length, 1, 'done'),
    make('three', 'Three done', 'Complete three tasks.', myDone.length, 3, 'done'),
    make('critical', 'Critical work', 'Complete a critical task.', criticalDone, 1, 'critical'),
    make('unblocker', 'Unblocker', 'Complete two tasks other work depended on.', unblockedByMe, 2, 'unblocked'),
    make('heavy', 'Heavy lifting', 'Complete two tasks estimated at 12h or more.', bigDone, 2, 'large'),
    make('streak', 'Three-day streak', 'Finish something three days running.', me.bestStreak, 3, 'days'),
    make('breadth', 'Every group', 'Complete work in every group.', groupsTouched, Object.keys(data.groups).length, 'groups'),
    make('time', 'Time tracked', 'Log 20 hours against your own tasks.', Math.floor(loggedHours), 20, 'hours'),
    make('clear', 'Nothing blocked', 'Hold no blocked tasks.', noneBlocked ? 1 : 0, 1, 'state'),
    make('project', 'Project complete', 'Bring the whole board to done.', stats.done, stats.total, 'done'),
  ];
}
