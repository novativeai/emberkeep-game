'use client';

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { wouldCycle } from './graph';
import { uid } from './format';
import { buildSeed } from './seed';
import { taskXp, unlockedBy } from './selectors';
import type {
  Group,
  Filters,
  FocusTimer,
  ProjectData,
  Status,
  Task,
  UserId,
  ViewId,
} from './types';
import { STATUSES } from './types';

export interface Toast {
  id: string;
  text: string;
  tone: 'good' | 'bad' | 'info';
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export const DEFAULT_FILTERS: Filters = {
  assignee: 'all',
  status: 'all',
  priority: 'all',
  groupId: 'all',
  tag: 'all',
  readyOnly: false,
  blockedOnly: false,
  overdueOnly: false,
};

interface State {
  data: ProjectData;
  activeUser: UserId;
  view: ViewId;
  selectedId: string | null;
  hoveredId: string | null;
  search: string;
  filters: Filters;
  camera: Camera;
  /** Pending dependency draw: the node the link is being pulled from. */
  linkingFrom: string | null;
  inspectorOpen: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  vaultOpen: boolean;
  timer: FocusTimer;
  toast: Toast | null;
  past: ProjectData[];
  future: ProjectData[];
  hydrated: boolean;
  /** Server revision the local `data` is based on. */
  rev: number;
  /** True once the project has been fetched (or the fetch has failed). */
  loaded: boolean;
  syncState: 'idle' | 'saving' | 'offline';
  /** How durable the server's storage is. */
  storage: 'r2' | 'disk' | 'ephemeral';
}

interface Actions {
  setActiveUser: (u: UserId) => void;
  setView: (v: ViewId) => void;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  setSearch: (s: string) => void;
  setFilter: <K extends keyof Filters>(k: K, v: Filters[K]) => void;
  resetFilters: () => void;
  setCamera: (c: Partial<Camera>) => void;
  setInspector: (open: boolean) => void;
  setPalette: (open: boolean) => void;
  setHelp: (open: boolean) => void;
  setVault: (open: boolean) => void;
  beginLink: (id: string | null) => void;
  completeLink: (toId: string) => void;

  addTask: (patch?: Partial<Task>) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => void;
  duplicateTask: (id: string) => void;
  setStatus: (id: string, status: Status) => void;
  advance: (id: string) => void;
  assign: (id: string, user: UserId | null) => void;
  addDep: (taskId: string, depId: string) => boolean;
  removeDep: (taskId: string, depId: string) => void;
  addChecklistItem: (id: string, text: string) => void;
  toggleChecklistItem: (id: string, itemId: string) => void;
  removeChecklistItem: (id: string, itemId: string) => void;
  addComment: (id: string, body: string) => void;
  logWork: (id: string, minutes: number, note: string) => void;
  moveNode: (id: string, x: number, y: number) => void;
  clearLayout: () => void;

  addGroup: (name: string) => void;
  updateGroup: (id: string, patch: Partial<Group>) => void;
  deleteGroup: (id: string) => void;
  updateSettings: (patch: Partial<ProjectData['settings']>) => void;

  startTimer: (taskId: string) => void;
  pauseTimer: () => void;
  stopTimer: (commitLog: boolean) => void;

  undo: () => void;
  redo: () => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
  clearToast: () => void;
  exportJson: () => string;
  importJson: (raw: string) => boolean;
  resetToSeed: () => void;
  setHydrated: () => void;
  /** Replace local data with the server's copy; does not touch undo history. */
  applyServerProject: (project: ProjectData, rev: number) => void;
}

export type Store = State & Actions;

const HISTORY_LIMIT = 60;

function clone<T>(v: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(v)
    : (JSON.parse(JSON.stringify(v)) as T);
}

function blankTask(data: ProjectData, patch: Partial<Task>): Task {
  const now = Date.now();
  const firstConstellation =
    Object.values(data.groups).sort((a, b) => a.order - b.order)[0]?.id ?? 'core';
  return {
    id: uid('t'),
    key: `EMB-${String(data.nextKey).padStart(2, '0')}`,
    title: 'New task',
    notes: '',
    status: 'backlog',
    priority: 'normal',
    assignee: null,
    groupId: firstConstellation,
    deps: [],
    tags: [],
    estimate: 4,
    due: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    checklist: [],
    comments: [],
    logs: [],
    attachments: [],
    pos: null,
    ...patch,
  };
}

export const useStore = create<Store>()(
  persist(
    (set, get) => {
      /** Every data mutation goes through here so undo always has a snapshot. */
      const mutate = (fn: (d: ProjectData) => void) => {
        const state = get();
        const before = state.data;
        const next = clone(before);
        fn(next);
        set({
          data: next,
          past: [...state.past, before].slice(-HISTORY_LIMIT),
          future: [],
        });
      };

      const touch = (t: Task) => {
        t.updatedAt = Date.now();
      };

      return {
        data: buildSeed(Date.now()),
        activeUser: 'aina',
        view: 'graph',
        selectedId: null,
        hoveredId: null,
        search: '',
        filters: { ...DEFAULT_FILTERS },
        camera: { x: 0, y: 0, zoom: 1 },
        linkingFrom: null,
        inspectorOpen: true,
        paletteOpen: false,
        helpOpen: false,
        vaultOpen: false,
        timer: { taskId: null, startedAt: null, elapsed: 0 },
        toast: null,
        past: [],
        future: [],
        hydrated: false,
        rev: 0,
        loaded: false,
        syncState: 'idle',
        storage: 'disk',

        setActiveUser: (u) => set({ activeUser: u }),
        setView: (v) => set({ view: v }),
        select: (id) => set({ selectedId: id, inspectorOpen: id ? true : get().inspectorOpen }),
        hover: (id) => set({ hoveredId: id }),
        setSearch: (s) => set({ search: s }),
        setFilter: (k, v) => set({ filters: { ...get().filters, [k]: v } }),
        resetFilters: () => set({ filters: { ...DEFAULT_FILTERS }, search: '' }),
        setCamera: (c) => set({ camera: { ...get().camera, ...c } }),
        setInspector: (open) => set({ inspectorOpen: open }),
        setPalette: (open) => set({ paletteOpen: open }),
        setHelp: (open) => set({ helpOpen: open }),
        setVault: (open) => set({ vaultOpen: open }),
        beginLink: (id) => set({ linkingFrom: id }),

        completeLink: (toId) => {
          const from = get().linkingFrom;
          set({ linkingFrom: null });
          if (!from || from === toId) return;
          get().addDep(toId, from);
        },

        addTask: (patch = {}) => {
          const t = blankTask(get().data, patch);
          mutate((d) => {
            d.tasks[t.id] = t;
            d.order.push(t.id);
            d.nextKey += 1;
          });
          set({ selectedId: t.id, inspectorOpen: true });
          return t.id;
        },

        updateTask: (id, patch) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (!t) return;
            Object.assign(t, patch);
            touch(t);
          }),

        deleteTask: (id) => {
          const title = get().data.tasks[id]?.title ?? 'Task';
          mutate((d) => {
            delete d.tasks[id];
            d.order = d.order.filter((x) => x !== id);
            for (const t of Object.values(d.tasks)) {
              if (t.deps.includes(id)) t.deps = t.deps.filter((x) => x !== id);
            }
          });
          set({ selectedId: null });
          get().pushToast(`${title} deleted.`, 'bad');
        },

        duplicateTask: (id) => {
          const src = get().data.tasks[id];
          if (!src) return;
          const copy = blankTask(get().data, {
            ...clone(src),
            id: uid('t'),
            key: `EMB-${String(get().data.nextKey).padStart(2, '0')}`,
            title: `${src.title} (echo)`,
            status: 'backlog',
            completedAt: null,
            startedAt: null,
            logs: [],
            comments: [],
            pos: src.pos ? { x: src.pos.x + 40, y: src.pos.y + 40 } : null,
          });
          mutate((d) => {
            d.tasks[copy.id] = copy;
            d.order.push(copy.id);
            d.nextKey += 1;
          });
          set({ selectedId: copy.id });
        },

        setStatus: (id, status) => {
          const before = get().data.tasks[id];
          if (!before) return;
          mutate((d) => {
            const t = d.tasks[id]!;
            const now = Date.now();
            t.status = status;
            if (status === 'done') {
              t.completedAt = t.completedAt ?? now;
              t.startedAt = t.startedAt ?? now;
            } else {
              t.completedAt = null;
              if (status === 'active' && !t.startedAt) t.startedAt = now;
              if (status === 'backlog' || status === 'ready') t.startedAt = null;
            }
            touch(t);
          });
          if (status === 'done' && before.status !== 'done') {
            const freed = unlockedBy(get().data, id);
            const xp = taskXp(before);
            get().pushToast(
              freed.length
                ? `+${xp} XP · ${freed.length} ${freed.length === 1 ? 'task' : 'tasks'} kindled`
                : `+${xp} XP · ${before.key} done`,
              'good',
            );
          }
        },

        advance: (id) => {
          const t = get().data.tasks[id];
          if (!t) return;
          const i = STATUSES.indexOf(t.status);
          const next = STATUSES[Math.min(i + 1, STATUSES.length - 1)]!;
          if (next !== t.status) get().setStatus(id, next);
        },

        assign: (id, user) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (!t) return;
            t.assignee = user;
            touch(t);
          }),

        addDep: (taskId, depId) => {
          const d = get().data;
          if (!d.tasks[taskId] || !d.tasks[depId]) return false;
          if (d.tasks[taskId]!.deps.includes(depId)) return false;
          if (wouldCycle(d.tasks, taskId, depId)) {
            get().pushToast('That link would create a cycle.', 'bad');
            return false;
          }
          mutate((n) => {
            n.tasks[taskId]!.deps.push(depId);
            touch(n.tasks[taskId]!);
          });
          get().pushToast(`${d.tasks[taskId]!.key} now depends on ${d.tasks[depId]!.key}.`, 'info');
          return true;
        },

        removeDep: (taskId, depId) =>
          mutate((d) => {
            const t = d.tasks[taskId];
            if (!t) return;
            t.deps = t.deps.filter((x) => x !== depId);
            touch(t);
          }),

        addChecklistItem: (id, text) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (!t || !text.trim()) return;
            t.checklist.push({ id: uid('c'), text: text.trim(), done: false });
            touch(t);
          }),

        toggleChecklistItem: (id, itemId) =>
          mutate((d) => {
            const item = d.tasks[id]?.checklist.find((c) => c.id === itemId);
            if (item) item.done = !item.done;
          }),

        removeChecklistItem: (id, itemId) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (t) t.checklist = t.checklist.filter((c) => c.id !== itemId);
          }),

        addComment: (id, body) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (!t || !body.trim()) return;
            t.comments.push({
              id: uid('m'),
              author: get().activeUser,
              body: body.trim(),
              at: Date.now(),
            });
            touch(t);
          }),

        logWork: (id, minutes, note) => {
          if (minutes <= 0) return;
          mutate((d) => {
            const t = d.tasks[id];
            if (!t) return;
            t.logs.push({
              id: uid('l'),
              by: get().activeUser,
              minutes: Math.round(minutes),
              at: Date.now(),
              note,
            });
            touch(t);
          });
          get().pushToast(`${Math.round(minutes)} minutes logged.`, 'info');
        },

        moveNode: (id, x, y) =>
          mutate((d) => {
            const t = d.tasks[id];
            if (t) t.pos = { x, y };
          }),

        clearLayout: () => {
          mutate((d) => {
            for (const t of Object.values(d.tasks)) t.pos = null;
          });
          get().pushToast('Layout reset.', 'info');
        },

        addGroup: (name) =>
          mutate((d) => {
            const id = uid('k');
            const order = Object.keys(d.groups).length;
            d.groups[id] = { id, name, glyph: '✦', blurb: '', order };
          }),

        updateGroup: (id, patch) =>
          mutate((d) => {
            const c = d.groups[id];
            if (c) Object.assign(c, patch);
          }),

        deleteGroup: (id) => {
          const remaining = Object.keys(get().data.groups).filter((k) => k !== id);
          if (remaining.length === 0) {
            get().pushToast('The last group cannot be deleted.', 'bad');
            return;
          }
          mutate((d) => {
            delete d.groups[id];
            const fallback = remaining[0]!;
            for (const t of Object.values(d.tasks)) {
              if (t.groupId === id) t.groupId = fallback;
            }
          });
        },

        updateSettings: (patch) =>
          mutate((d) => {
            Object.assign(d.settings, patch);
          }),

        startTimer: (taskId) => {
          const t = get().timer;
          const carry = t.taskId === taskId ? t.elapsed : 0;
          set({ timer: { taskId, startedAt: Date.now(), elapsed: carry } });
        },

        pauseTimer: () => {
          const t = get().timer;
          if (!t.startedAt) return;
          set({
            timer: { ...t, startedAt: null, elapsed: t.elapsed + (Date.now() - t.startedAt) },
          });
        },

        stopTimer: (commitLog) => {
          const t = get().timer;
          const total = t.elapsed + (t.startedAt ? Date.now() - t.startedAt : 0);
          if (commitLog && t.taskId && total > 30_000) {
            get().logWork(t.taskId, total / 60_000, 'Focus session');
          }
          set({ timer: { taskId: null, startedAt: null, elapsed: 0 } });
        },

        undo: () => {
          const { past, data, future } = get();
          const prev = past[past.length - 1];
          if (!prev) return;
          set({ data: prev, past: past.slice(0, -1), future: [data, ...future].slice(0, HISTORY_LIMIT) });
          get().pushToast('Undone.', 'info');
        },

        redo: () => {
          const { past, data, future } = get();
          const next = future[0];
          if (!next) return;
          set({ data: next, past: [...past, data].slice(-HISTORY_LIMIT), future: future.slice(1) });
          get().pushToast('Redone.', 'info');
        },

        pushToast: (text, tone = 'info') => set({ toast: { id: uid('toast'), text, tone } }),
        clearToast: () => set({ toast: null }),

        exportJson: () => JSON.stringify(get().data, null, 2),

        importJson: (raw) => {
          try {
            const parsed = JSON.parse(raw) as ProjectData;
            if (!parsed || typeof parsed !== 'object' || !parsed.tasks || !parsed.order) {
              throw new Error('shape');
            }
            // Drop dangling ids rather than trusting the file.
            for (const t of Object.values(parsed.tasks)) {
              t.deps = t.deps.filter((d) => Boolean(parsed.tasks[d]));
            }
            parsed.order = parsed.order.filter((id) => Boolean(parsed.tasks[id]));
            for (const id of Object.keys(parsed.tasks)) {
              if (!parsed.order.includes(id)) parsed.order.push(id);
            }
            set({
              data: parsed,
              past: [...get().past, get().data].slice(-HISTORY_LIMIT),
              future: [],
              selectedId: null,
            });
            get().pushToast('Project imported.', 'good');
            return true;
          } catch {
            get().pushToast('That file is not a valid project export.', 'bad');
            return false;
          }
        },

        resetToSeed: () => {
          set({
            data: buildSeed(Date.now()),
            past: [...get().past, get().data].slice(-HISTORY_LIMIT),
            future: [],
            selectedId: null,
          });
          get().pushToast('Reset to the default board.', 'info');
        },

        setHydrated: () => set({ hydrated: true }),

        applyServerProject: (project, rev) => {
          const selected = get().selectedId;
          set({
            data: project,
            rev,
            // A task deleted elsewhere must not stay selected.
            selectedId: selected && project.tasks[selected] ? selected : null,
          });
        },
      };
    },
    {
      name: 'path-of-embers',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // `data` is deliberately absent: the project lives on the server now, and
      // a stale localStorage copy would race the fetch on every load. Only the
      // per-browser view preferences persist here.
      partialize: (s) => ({
        activeUser: s.activeUser,
        view: s.view,
        filters: s.filters,
        camera: s.camera,
        inspectorOpen: s.inspectorOpen,
      }),
      // Rendering waits on this so the server-rendered tree and the
      // localStorage-restored one can never disagree.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Heal a stored filter combination that can only ever match nothing:
        // "ready" and "blocked" are opposites, so a browser that saved both
        // would otherwise open to a permanently empty board.
        if (state.filters.readyOnly && state.filters.blockedOnly) {
          state.filters = { ...state.filters, blockedOnly: false };
        }
        state.setHydrated();
      },
    },
  ),
);
