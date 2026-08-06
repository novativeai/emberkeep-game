import type { Group, Task } from './types';

/**
 * Dependency-graph maths: layering, crossing reduction, cycle safety and the
 * critical path. Pure functions over a task map — no React, no store.
 *
 * Edge direction: `task.deps` holds the tasks that must finish first, so an
 * edge runs dep → task and the graph flows left to right.
 */

export const COL_W = 320;
export const ROW_H = 112;
export const NODE_W = 252;
export const NODE_H = 84;
/** Left gutter kept clear so band labels have somewhere to sit. */
export const GUTTER = 280;
const BAND_GAP = 34;

export interface Placed {
  id: string;
  x: number;
  y: number;
  layer: number;
  row: number;
  /** True when the position came from a manual drag rather than the layout. */
  pinned: boolean;
}

export interface Band {
  id: string;
  name: string;
  glyph: string;
  top: number;
  height: number;
}

export interface GraphLayout {
  nodes: Map<string, Placed>;
  layers: string[][];
  bands: Band[];
  width: number;
  height: number;
}

/** Deterministic small offset so the tree reads as a group, not a grid. */
function jitter(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 8) % 1000) / 1000 - 0.5;
}

/** Tasks that depend on the given one. */
export function buildChildren(tasks: Task[]): Map<string, string[]> {
  const kids = new Map<string, string[]>();
  const present = new Set(tasks.map((t) => t.id));
  for (const t of tasks) kids.set(t.id, []);
  for (const t of tasks) {
    for (const d of t.deps) {
      if (present.has(d)) kids.get(d)!.push(t.id);
    }
  }
  return kids;
}

/**
 * Longest-path layering. Cyclic input cannot hang this: every node is visited
 * once and a node already on the stack contributes layer 0.
 */
function layerOf(tasks: Task[]): Map<string, number> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const layer = new Map<string, number>();
  const state = new Map<string, 0 | 1 | 2>();

  const walk = (id: string): number => {
    const st = state.get(id);
    if (st === 2) return layer.get(id) ?? 0;
    if (st === 1) return 0; // cycle guard
    state.set(id, 1);
    const t = byId.get(id);
    let best = 0;
    if (t) {
      for (const d of t.deps) {
        if (byId.has(d)) best = Math.max(best, walk(d) + 1);
      }
    }
    state.set(id, 2);
    layer.set(id, best);
    return best;
  };

  for (const t of tasks) walk(t.id);
  return layer;
}

/**
 * Sugiyama-style layering, then banded placement.
 *
 * X is global dependency depth, so the whole graph still reads strictly left to
 * right — a task is always right of everything it waits on. Y is grouped by
 * group, which is what makes forty-odd nodes legible: each path of work
 * gets its own horizontal band instead of one tall undifferentiated column.
 * Crossing reduction runs first and only decides the order inside a band cell.
 */
export function layoutGraph(
  tasks: Task[],
  groups: Group[],
  opts: { sweeps?: number } = {},
): GraphLayout {
  if (tasks.length === 0) {
    return { nodes: new Map(), layers: [], bands: [], width: COL_W, height: ROW_H };
  }
  const groupOrder = new Map(groups.map((c) => [c.id, c.order]));

  const layerMap = layerOf(tasks);
  const kids = buildChildren(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const present = new Set(byId.keys());

  const maxLayer = Math.max(...tasks.map((t) => layerMap.get(t.id) ?? 0));
  const layers: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const t of tasks) layers[layerMap.get(t.id) ?? 0]!.push(t.id);

  const rank = (id: string): number => {
    const t = byId.get(id)!;
    return (groupOrder.get(t.groupId) ?? 99) * 1000 + t.key.charCodeAt(t.key.length - 1);
  };
  for (const l of layers) l.sort((a, b) => rank(a) - rank(b));

  const pos = new Map<string, number>();
  const reindex = () => {
    for (const l of layers) l.forEach((id, i) => pos.set(id, i));
  };
  reindex();

  const bary = (ids: string[]): number => {
    const known = ids.map((i) => pos.get(i)).filter((v): v is number => v !== undefined);
    if (known.length === 0) return Number.POSITIVE_INFINITY;
    return known.reduce((a, b) => a + b, 0) / known.length;
  };

  const sweeps = opts.sweeps ?? 6;
  for (let s = 0; s < sweeps; s += 1) {
    const down = s % 2 === 0;
    const seq = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
    for (const li of seq) {
      const layer = layers[li]!;
      const weights = new Map<string, number>();
      for (const id of layer) {
        const neighbours = down
          ? (byId.get(id)!.deps.filter((d) => present.has(d)))
          : (kids.get(id) ?? []);
        const w = bary(neighbours);
        weights.set(id, Number.isFinite(w) ? w : pos.get(id)!);
      }
      layer.sort((a, b) => (weights.get(a)! - weights.get(b)!) || rank(a) - rank(b));
      layer.forEach((id, i) => pos.set(id, i));
    }
  }

  // ── Banded placement: one horizontal band per group ────────────
  const nodes = new Map<string, Placed>();
  const bands: Band[] = [];
  const ordered = [...groups].sort((a, b) => a.order - b.order);
  const seen = new Set<string>();
  let bandTop = ROW_H * 0.55;

  const placeBand = (id: string, name: string, glyph: string, members: Task[]) => {
    if (members.length === 0) return;
    const cells = new Map<number, string[]>();
    for (const t of members) {
      const li = layerMap.get(t.id) ?? 0;
      const cell = cells.get(li);
      if (cell) cell.push(t.id);
      else cells.set(li, [t.id]);
    }
    for (const cell of cells.values()) cell.sort((a, b) => pos.get(a)! - pos.get(b)!);

    const rows = Math.max(...[...cells.values()].map((c) => c.length));
    const height = rows * ROW_H;

    for (const [li, cell] of cells) {
      const start = (rows - cell.length) / 2;
      cell.forEach((tid, i) => {
        const t = byId.get(tid)!;
        const pinned = t.pos !== null;
        nodes.set(tid, {
          id: tid,
          x: pinned ? t.pos!.x : GUTTER + li * COL_W + jitter(tid, 1) * 16,
          y: pinned
            ? t.pos!.y
            : bandTop + (start + i + 0.5) * ROW_H + jitter(tid, 2) * 12,
          layer: li,
          row: i,
          pinned,
        });
        seen.add(tid);
      });
    }

    bands.push({ id, name, glyph, top: bandTop, height });
    bandTop += height + BAND_GAP;
  };

  for (const c of ordered) {
    placeBand(c.id, c.name, c.glyph, tasks.filter((t) => t.groupId === c.id));
  }
  // Anything pointing at a group that no longer exists still needs a home.
  placeBand('__orphans', 'Unbound', '✧', tasks.filter((t) => !seen.has(t.id)));

  let width = COL_W;
  let height = ROW_H;
  for (const n of nodes.values()) {
    width = Math.max(width, n.x + COL_W);
    height = Math.max(height, n.y + ROW_H);
  }
  return { nodes, layers, bands, width, height };
}

/**
 * Would making `taskId` depend on `depId` close a loop? True when `depId` is
 * already downstream of `taskId`.
 */
export function wouldCycle(tasks: Record<string, Task>, taskId: string, depId: string): boolean {
  if (taskId === depId) return true;
  const kids = new Map<string, string[]>();
  for (const t of Object.values(tasks)) {
    for (const d of t.deps) {
      const arr = kids.get(d);
      if (arr) arr.push(t.id);
      else kids.set(d, [t.id]);
    }
  }
  const seen = new Set<string>([taskId]);
  const stack = [taskId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of kids.get(cur) ?? []) {
      if (next === depId) return true;
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/** Every task reachable downstream of the given one, itself excluded. */
export function descendants(tasks: Record<string, Task>, id: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const t of Object.values(tasks)) {
    for (const d of t.deps) {
      const arr = kids.get(d);
      if (arr) arr.push(t.id);
      else kids.set(d, [t.id]);
    }
  }
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    for (const next of kids.get(stack.pop()!) ?? []) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

/** Every task the given one waits on, transitively. */
export function ancestors(tasks: Record<string, Task>, id: string): Set<string> {
  const out = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const t = tasks[stack.pop()!];
    if (!t) continue;
    for (const d of t.deps) {
      if (!out.has(d) && tasks[d]) {
        out.add(d);
        stack.push(d);
      }
    }
  }
  return out;
}

/**
 * The longest remaining chain by estimate — the sequence that actually sets the
 * finish date. Completed work costs nothing, so the path tracks what is left.
 */
export function criticalPath(tasks: Record<string, Task>): string[] {
  const list = Object.values(tasks);
  const byId = new Map(list.map((t) => [t.id, t]));
  const cost = (t: Task) => (t.status === 'done' ? 0 : Math.max(t.estimate, 0.5));

  const best = new Map<string, { total: number; next: string | null }>();
  const state = new Map<string, 0 | 1 | 2>();

  const walk = (id: string): number => {
    const st = state.get(id);
    if (st === 2) return best.get(id)!.total;
    if (st === 1) return 0;
    state.set(id, 1);
    const t = byId.get(id)!;
    let total = cost(t);
    let next: string | null = null;
    for (const d of t.deps) {
      if (!byId.has(d)) continue;
      const sub = walk(d);
      if (sub + cost(t) > total) {
        total = sub + cost(t);
        next = d;
      }
    }
    state.set(id, 2);
    best.set(id, { total, next });
    return total;
  };

  for (const t of list) walk(t.id);

  let head: string | null = null;
  let headTotal = -1;
  for (const t of list) {
    const b = best.get(t.id);
    if (b && b.total > headTotal) {
      headTotal = b.total;
      head = t.id;
    }
  }
  const chain: string[] = [];
  let cur = head;
  const guard = new Set<string>();
  while (cur && !guard.has(cur)) {
    guard.add(cur);
    chain.push(cur);
    cur = best.get(cur)?.next ?? null;
  }
  return chain.reverse();
}

/**
 * Earliest start/finish per task in working hours from project start, given
 * that a task cannot start until every dependency has finished.
 */
export function scheduleHours(tasks: Record<string, Task>): Map<string, { start: number; end: number }> {
  const byId = new Map(Object.entries(tasks));
  const out = new Map<string, { start: number; end: number }>();
  const state = new Map<string, 0 | 1 | 2>();

  const walk = (id: string): { start: number; end: number } => {
    const known = out.get(id);
    if (state.get(id) === 2 && known) return known;
    if (state.get(id) === 1) return { start: 0, end: 0 };
    state.set(id, 1);
    const t = byId.get(id)!;
    let start = 0;
    for (const d of t.deps) {
      if (byId.has(d)) start = Math.max(start, walk(d).end);
    }
    const span = { start, end: start + Math.max(t.estimate, 0.5) };
    state.set(id, 2);
    out.set(id, span);
    return span;
  };

  for (const id of byId.keys()) walk(id);
  return out;
}
