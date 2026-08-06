/** Domain model for the Emberkeep development board. */

/** The two developers. Everything user-scoped keys off these ids. */
export type UserId = 'aina' | 'onja';

/**
 * Workflow states. `blocked` is deliberately NOT one of them — being blocked is
 * derived from whether a task's dependencies are done, so it can never drift
 * out of sync with the graph. See `isBlocked` in selectors.
 */
export type Status = 'backlog' | 'ready' | 'active' | 'review' | 'done';

export type Priority = 'low' | 'normal' | 'high' | 'critical';

export type ViewId = 'graph' | 'board' | 'list' | 'timeline' | 'stats';

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Comment {
  id: string;
  author: UserId;
  body: string;
  at: number;
}

/** A file stored in R2 and linked to a task. */
export interface Attachment {
  id: string;
  /** Original file name, shown in the UI and used for the download. */
  name: string;
  /** Object key in the bucket. Never exposed as a public URL. */
  key: string;
  size: number;
  contentType: string;
  uploadedBy: UserId | null;
  uploadedAt: number;
}

/** A logged work session, in minutes. Drives spent-vs-estimate and velocity. */
export interface WorkLog {
  id: string;
  by: UserId;
  minutes: number;
  at: number;
  note: string;
}

export interface Task {
  id: string;
  /** Short human key, e.g. "EMB-4" — stable, shown on the card. */
  key: string;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  assignee: UserId | null;
  groupId: string;
  /** Ids of tasks that must be `done` before this one can start. */
  deps: string[];
  tags: string[];
  /** Estimate in hours. Feeds the timeline, the critical path and points. */
  estimate: number;
  due: string | null;
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  checklist: ChecklistItem[];
  comments: Comment[];
  logs: WorkLog[];
  attachments: Attachment[];
  /** Manual graph placement; null means "let the layout engine decide". */
  pos: { x: number; y: number } | null;
}

/** A group of related work. Renders as a lane in the graph and elsewhere. */
export interface Group {
  id: string;
  name: string;
  /** Short label shown on the card when nothing better fits. */
  glyph: string;
  blurb: string;
  order: number;
}

export interface Settings {
  /** Day one — the timeline lays out forward from here. */
  startDate: string;
  /** Working hours per day, per developer. Converts estimates into calendar. */
  hoursPerDay: number;
  showDoneInGraph: boolean;
  snapToGrid: boolean;
}

export interface ProjectData {
  version: number;
  tasks: Record<string, Task>;
  groups: Record<string, Group>;
  /** Insertion order of task ids — the stable order for list/board rendering. */
  order: string[];
  settings: Settings;
  /** Monotonic counter behind the EMB-n keys. */
  nextKey: number;
}

export interface Filters {
  assignee: UserId | 'all' | 'unassigned';
  status: Status | 'all';
  priority: Priority | 'all';
  groupId: string | 'all';
  tag: string | 'all';
  /** Only show tasks that are startable right now (deps satisfied, not done). */
  readyOnly: boolean;
  blockedOnly: boolean;
  overdueOnly: boolean;
}

export interface FocusTimer {
  taskId: string | null;
  startedAt: number | null;
  /** Accumulated ms from previous runs of this same sitting. */
  elapsed: number;
}

export const STATUSES: readonly Status[] = ['backlog', 'ready', 'active', 'review', 'done'];
export const PRIORITIES: readonly Priority[] = ['low', 'normal', 'high', 'critical'];
export const USERS: readonly UserId[] = ['aina', 'onja'];

export const STATUS_LABEL: Record<Status, string> = {
  backlog: 'Backlog',
  ready: 'Ready',
  active: 'In progress',
  review: 'Review',
  done: 'Done',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  critical: 'Critical',
};

export interface UserProfile {
  id: UserId;
  name: string;
  title: string;
  /** CSS custom-property block applied when this user is active. */
  accent: string;
  accentSoft: string;
  accentDeep: string;
  glow: string;
}

export const USER_PROFILE: Record<UserId, UserProfile> = {
  aina: {
    id: 'aina',
    name: 'Aina',
    title: 'Developer',
    accent: '#4FC3F7',
    accentSoft: '#A5E4FF',
    accentDeep: '#12557E',
    glow: 'rgba(79, 195, 247, 0.45)',
  },
  onja: {
    id: 'onja',
    name: 'Onja',
    title: 'Developer',
    accent: '#FF6A3D',
    accentSoft: '#FFB08A',
    accentDeep: '#8E2E15',
    glow: 'rgba(255, 106, 61, 0.45)',
  },
};
