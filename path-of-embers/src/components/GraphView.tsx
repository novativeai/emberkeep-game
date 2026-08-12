'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import { GUTTER, NODE_W, ancestors, criticalPath, descendants, layoutGraph } from '@/lib/graph';
import { filterTasks, isBlocked, isReady, taskXp } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { PRIORITY_LABEL, STATUS_LABEL, USER_PROFILE } from '@/lib/types';

import { TaskNode, taskColor } from './TaskNode';

interface Drag {
  id: string;
  x: number;
  y: number;
  moved: boolean;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 2.2;
/** Screen the characters occupy; the fit keeps the graph clear of them. */
const ART_GUTTER_L = 250;
const ART_GUTTER_R = 250;

export function GraphView() {
  const data = useStore((s) => s.data);
  const filters = useStore((s) => s.filters);
  const search = useStore((s) => s.search);
  const selectedId = useStore((s) => s.selectedId);
  const hoveredId = useStore((s) => s.hoveredId);
  const camera = useStore((s) => s.camera);
  const linkingFrom = useStore((s) => s.linkingFrom);
  const timerTaskId = useStore((s) => s.timer.taskId);
  const select = useStore((s) => s.select);
  const hover = useStore((s) => s.hover);
  const setCamera = useStore((s) => s.setCamera);
  const clearLayout = useStore((s) => s.clearLayout);
  const beginLink = useStore((s) => s.beginLink);
  const updateSettings = useStore((s) => s.updateSettings);
  const setInspector = useStore((s) => s.setInspector);
  const resetFilters = useStore((s) => s.resetFilters);
  const addTask = useStore((s) => s.addTask);
  const activeUser = useStore((s) => s.activeUser);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [pointerWorld, setPointerWorld] = useState<{ x: number; y: number } | null>(null);

  /*
   * Pointer state is held in refs as well as state. The window listeners are
   * attached once and read the refs, so a pointerup that lands in the same task
   * as its pointerdown — which React has not re-rendered for yet — is still
   * handled. State exists only to drive rendering.
   */
  const dragRef = useRef<Drag | null>(null);
  const [drag, setDragState] = useState<Drag | null>(null);
  const setDrag = useCallback((v: Drag | null) => {
    dragRef.current = v;
    setDragState(v);
  }, []);

  const panRef = useRef(false);
  const [panning, setPanningState] = useState(false);
  const setPanning = useCallback((v: boolean) => {
    panRef.current = v;
    setPanningState(v);
  }, []);

  /** True once the user has taken control of the camera themselves. */
  const userMoved = useRef(false);

  const visible = useMemo(() => {
    const list = filterTasks(data, filters, search);
    return data.settings.showDoneInGraph ? list : list.filter((t) => t.status !== 'done');
  }, [data, filters, search]);

  const groupList = useMemo(
    () => Object.values(data.groups).sort((a, b) => a.order - b.order),
    [data.groups],
  );

  const layout = useMemo(
    () => layoutGraph(visible, groupList),
    [visible, groupList],
  );

  const critical = useMemo(() => new Set(criticalPath(data.tasks)), [data.tasks]);

  /** Everything up- and downstream of the focused node, for the dim pass. */
  const related = useMemo(() => {
    const focus = hoveredId ?? selectedId;
    if (!focus || !data.tasks[focus]) return null;
    const set = new Set<string>([focus]);
    for (const id of ancestors(data.tasks, focus)) set.add(id);
    for (const id of descendants(data.tasks, focus)) set.add(id);
    return set;
  }, [hoveredId, selectedId, data.tasks]);

  /** Reads the live camera, never a closed-over copy. */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    const cam = useStore.getState().camera;
    if (!r) return { x: 0, y: 0 };
    return {
      x: (clientX - r.left - cam.x) / cam.zoom,
      y: (clientY - r.top - cam.y) / cam.zoom,
    };
  }, []);

  const nodePos = useCallback(
    (id: string) => {
      if (drag && drag.id === id) return { x: drag.x, y: drag.y };
      const p = layout.nodes.get(id);
      return p ? { x: p.x, y: p.y } : null;
    },
    [drag, layout],
  );

  /** The clear strip between the two characters. */
  const stage = useCallback(() => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return null;
    const left = Math.min(ART_GUTTER_L, r.width * 0.2);
    const right = Math.min(ART_GUTTER_R, r.width * 0.2);
    return { r, left, right, w: r.width - left - right, cx: left + (r.width - left - right) / 2 };
  }, []);

  /** Fit the whole group into the clear strip. */
  const fit = useCallback(() => {
    const st = stage();
    if (!st || layout.nodes.size === 0) return;
    userMoved.current = true;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of layout.nodes.values()) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x);
      maxY = Math.max(maxY, n.y);
    }
    const pad = 90;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(st.w / w, st.r.height / h)));
    setCamera({
      zoom,
      x: st.cx - ((minX + maxX) / 2) * zoom,
      y: st.r.height / 2 - ((minY + maxY) / 2) * zoom,
    });
  }, [layout, setCamera, stage]);

  /**
   * Land on the live work at a readable zoom rather than fitting everything —
   * forty nodes squeezed onto a laptop screen are unreadable dots.
   */
  const focusLive = useCallback(() => {
    const st = stage();
    if (!st || layout.nodes.size === 0) return;
    const live = visible.filter(
      (t) => t.status === 'active' || t.status === 'review' || isReady(data, t),
    );
    const pick = (live.length ? live : visible)
      .map((t) => layout.nodes.get(t.id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (pick.length === 0) return;
    const cx = pick.reduce((a, p) => a + p.x, 0) / pick.length;
    const cy = pick.reduce((a, p) => a + p.y, 0) / pick.length;
    const zoom = 0.72;
    setCamera({ zoom, x: st.cx - cx * zoom, y: st.r.height / 2 - cy * zoom });
  }, [stage, layout, visible, data, setCamera]);

  /**
   * Re-centre whenever the stage resizes, until the user takes the camera over.
   * Web fonts land after first paint and change the header's height, so a
   * one-shot centring on mount would settle in a different place every load.
   */
  const focusLiveRef = useRef(focusLive);
  focusLiveRef.current = focusLive;

  useEffect(() => {
    // A camera restored from a previous session is already the user's choice.
    const cam = useStore.getState().camera;
    if (!(cam.x === 0 && cam.y === 0 && cam.zoom === 1)) userMoved.current = true;
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (!userMoved.current) focusLiveRef.current();
    });
    ro.observe(el);
    if (!userMoved.current) focusLiveRef.current();
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onFit = () => {
      userMoved.current = true;
      fit();
    };
    window.addEventListener('poe:fit', onFit);
    return () => window.removeEventListener('poe:fit', onFit);
  }, [fit]);

  // ── Pointer plumbing: pan, node drag, and dependency drawing ────────────
  // Attached once, for the lifetime of the view — see the note on the refs.
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const s = useStore.getState();
      if (panRef.current) {
        userMoved.current = true;
        s.setCamera({ x: s.camera.x + e.movementX, y: s.camera.y + e.movementY });
        return;
      }
      const cur = dragRef.current;
      const w = toWorld(e.clientX, e.clientY);
      if (cur) {
        userMoved.current = true;
        setDrag({ ...cur, x: w.x, y: w.y, moved: true });
      } else if (s.linkingFrom) {
        setPointerWorld(w);
      }
    };

    const up = (e: PointerEvent) => {
      const s = useStore.getState();
      const cur = dragRef.current;
      if (cur) {
        if (cur.moved) s.moveNode(cur.id, cur.x, cur.y);
        else s.select(cur.id);
        setDrag(null);
      }
      if (s.linkingFrom) {
        const host = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>('[data-task-id]');
        if (host?.dataset.taskId) s.completeLink(host.dataset.taskId);
        else s.beginLink(null);
        setPointerWorld(null);
      }
      setPanning(false);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [toWorld, setDrag, setPanning]);

  const onWheel = (e: React.WheelEvent) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    userMoved.current = true;
    const factor = Math.exp(-e.deltaY * 0.0012);
    const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, camera.zoom * factor));
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    setCamera({
      zoom,
      x: px - ((px - camera.x) / camera.zoom) * zoom,
      y: py - ((py - camera.y) / camera.zoom) * zoom,
    });
  };

  const startNodeDrag = (id: string) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    setDrag({ id, x: w.x, y: w.y, moved: false });
    select(id);
  };

  const startLink = (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    beginLink(id);
    setPointerWorld(toWorld(e.clientX, e.clientY));
  };

  // ── Links ──────────────────────────────────────────────────────────────
  const links = useMemo(() => {
    const shown = new Set(visible.map((t) => t.id));
    const out: {
      key: string;
      d: string;
      satisfied: boolean;
      crit: boolean;
      dim: boolean;
      /** Crossing groups — kept faint so the bands stay readable. */
      far: boolean;
      colour: string;
      mid: { x: number; y: number };
    }[] = [];

    for (const t of visible) {
      const to = nodePos(t.id);
      if (!to) continue;
      for (const depId of t.deps) {
        if (!shown.has(depId)) continue;
        const from = nodePos(depId);
        const dep = data.tasks[depId];
        if (!from || !dep) continue;
        const x1 = from.x + NODE_W / 2;
        const y1 = from.y;
        const x2 = to.x - NODE_W / 2;
        const y2 = to.y;
        const dx = Math.max(46, Math.abs(x2 - x1) * 0.46);
        const satisfied = dep.status === 'done';
        const crit = critical.has(t.id) && critical.has(depId);
        const dim = related ? !(related.has(t.id) && related.has(depId)) : false;
        const far = dep.groupId !== t.groupId;
        out.push({
          key: `${depId}->${t.id}`,
          d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
          satisfied,
          crit,
          dim,
          far,
          colour: crit ? '#ff8a5c' : satisfied ? '#5fd39a' : '#7d90a3',
          mid: { x: (x1 + x2) / 2, y: (y1 + y2) / 2 },
        });
      }
    }
    // Faint links first so the strong ones are never buried under them.
    return out.sort((a, b) => Number(b.far) - Number(a.far));
  }, [visible, nodePos, data.tasks, critical, related]);

  const rubber = useMemo(() => {
    if (!linkingFrom || !pointerWorld) return null;
    const from = nodePos(linkingFrom);
    if (!from) return null;
    const x1 = from.x + NODE_W / 2;
    const dx = Math.max(40, Math.abs(pointerWorld.x - x1) * 0.45);
    return `M ${x1} ${from.y} C ${x1 + dx} ${from.y}, ${pointerWorld.x - dx} ${pointerWorld.y}, ${pointerWorld.x} ${pointerWorld.y}`;
  }, [linkingFrom, pointerWorld, nodePos]);

  const selected = selectedId ? data.tasks[selectedId] : null;
  const hoveredTask = hoveredId ? data.tasks[hoveredId] : null;
  const preview = hoveredTask ?? selected;
  const readyQueue = useMemo(
    () =>
      visible
        .filter((t) => isReady(data, t) && t.status !== 'done')
        .sort((a, b) => {
          const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
          return rank[a.priority] - rank[b.priority] || b.estimate - a.estimate;
        })
        .slice(0, 4),
    [visible, data],
  );


  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* ── Canvas ─────────────────────────────────────────────────────── */}
      <div
        ref={wrapRef}
        className="absolute inset-0 touch-none"
        style={{ cursor: panning ? 'grabbing' : linkingFrom ? 'crosshair' : 'grab' }}
        onPointerDown={(e) => {
          if (e.button === 0 && !linkingFrom) {
            setPanning(true);
            select(null);
          }
        }}
        onWheel={onWheel}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate3d(${camera.x}px, ${camera.y}px, 0) scale(${camera.zoom})`,
            width: layout.width,
            height: layout.height,
          }}
        >
          {/* Group bands — the horizontal register each path lives in. */}
          {layout.bands.map((b, i) => (
            <div
              key={b.id}
              className="pointer-events-none absolute left-0"
              style={{
                top: b.top,
                height: b.height,
                width: layout.width,
                background:
                  i % 2 === 0 ? 'rgba(126,166,206,0.045)' : 'rgba(126,166,206,0.015)',
                borderTop: '1px solid rgba(240,196,106,0.07)',
                borderBottom: '1px solid rgba(4,9,15,0.5)',
              }}
            />
          ))}

          {/*
            Band labels live inside the transformed layer, so they cannot drift
            out of alignment with their nodes. Only their X tracks the viewport
            and their scale is undone, so they stay pinned and legible.
          */}
          {layout.bands.map((b) => (
            <div
              key={`label-${b.id}`}
              className="pointer-events-none absolute z-10"
              style={{
                top: b.top + b.height / 2,
                left: 0,
                width: GUTTER - 150,
                transform: 'translateY(-50%)',
              }}
            >
              <div className="flex items-center justify-end gap-2 pr-1">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-white/10 text-[10px] font-semibold text-parchment">{b.glyph}</span>
                <span className="text-[12px] font-medium leading-tight text-parchment/90">
                  {b.name}
                </span>
              </div>
            </div>
          ))}

          <svg
            className="pointer-events-none absolute left-0 top-0 overflow-visible"
            width={layout.width}
            height={layout.height}
          >
            {links.map((l) => (
              <g
                key={l.key}
                opacity={l.dim ? 0.09 : l.far && !related ? 0.34 : 1}
              >
                <path
                  d={l.d}
                  fill="none"
                  stroke={l.colour}
                  strokeWidth={l.crit ? 2.4 : l.far ? 1.2 : 1.8}
                  strokeOpacity={l.satisfied ? 0.7 : 0.5}
                  className={l.satisfied || l.far ? undefined : 'link-flow'}
                  style={l.crit ? { filter: 'drop-shadow(0 0 6px rgba(255,120,80,0.7))' } : undefined}
                />
                {l.satisfied && !l.far && (
                  <rect
                    x={l.mid.x - 3}
                    y={l.mid.y - 3}
                    width={6}
                    height={6}
                    fill={l.colour}
                    opacity={0.75}
                    transform={`rotate(45 ${l.mid.x} ${l.mid.y})`}
                    style={{ filter: 'drop-shadow(0 0 5px rgba(255,233,176,0.8))' }}
                  />
                )}
              </g>
            ))}
            {rubber && (
              <path
                d={rubber}
                fill="none"
                stroke="var(--accent)"
                strokeWidth={1.8}
                strokeDasharray="5 6"
                opacity={0.85}
              />
            )}
          </svg>

          {visible.map((t) => {
            const p = nodePos(t.id);
            if (!p) return null;
            return (
              <TaskNode
                key={t.id}
                task={t}
                x={p.x}
                y={p.y}
                blocked={isBlocked(data, t)}
                selected={selectedId === t.id}
                dimmed={related ? !related.has(t.id) : false}
                onCritical={critical.has(t.id)}
                isTimed={timerTaskId === t.id}
                onPointerDown={startNodeDrag(t.id)}
                onHandleDown={startLink(t.id)}
                onEnter={() => hover(t.id)}
                onLeave={() => hover(null)}
                onDoubleClick={() => {
                  select(t.id);
                  setInspector(true);
                }}
              />
            );
          })}
        </div>
      </div>

      {/*
        An empty canvas is ambiguous — it could mean no tasks or no matches.
        Say which, and offer the way out.
      */}
      {visible.length === 0 && (
        <div className="pointer-events-auto absolute inset-0 grid place-items-center">
          <div className="panel panel-in max-w-[380px] px-5 py-4 text-center">
            {data.order.length === 0 ? (
              <>
                <p className="text-[14px] font-medium text-cream">No tasks yet</p>
                <p className="mt-1 text-[12.5px] text-muted">
                  Create the first one to start building the graph.
                </p>
                <button
                  type="button"
                  className="btn btn-accent mt-3"
                  onClick={() => addTask({ assignee: activeUser })}
                >
                  + New task
                </button>
              </>
            ) : (
              <>
                <p className="text-[14px] font-medium text-cream">
                  No tasks match the current filters
                </p>
                <p className="mt-1 text-[12.5px] text-muted">
                  {data.order.length} {data.order.length === 1 ? 'task is' : 'tasks are'} hidden by
                  the filter bar above.
                </p>
                <button type="button" className="btn btn-accent mt-3" onClick={resetFilters}>
                  Clear filters
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Ready to start (bottom-left, clear of the artwork) ────────── */}
      <div className="pointer-events-auto absolute bottom-4 left-3 w-[210px]">
        <div className="panel px-3 py-2.5">
          <div className="t-label mb-1.5">Ready to start</div>
          {readyQueue.length === 0 ? (
            <p className="text-[12px] text-muted">Nothing is ready. Clear a blocker.</p>
          ) : (
            <ul className="space-y-0.5">
              {readyQueue.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    onClick={() => select(t.id)}
                    onPointerEnter={() => hover(t.id)}
                    onPointerLeave={() => hover(null)}
                    className="flex w-full items-center gap-2 rounded px-1 py-1 text-left transition-colors hover:bg-white/5"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: taskColor(t).main }}
                    />
                    <span className="truncate text-[12px] text-parchment">{t.title}</span>
                    <span className="t-num ml-auto shrink-0 text-[10px] text-muted">{t.estimate}h</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Hover / selection detail (bottom centre) ───────────────────── */}
      {preview && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 w-[min(520px,44vw)] -translate-x-1/2">
          <div className="panel panel-in px-3.5 py-2.5">
            <div className="flex items-baseline gap-2">
              <span className="t-num text-[10px] text-muted">{preview.key}</span>
              <h2 className="truncate text-[13.5px] font-semibold text-cream">{preview.title}</h2>
            </div>
            {preview.notes && (
              <p className="mt-0.5 line-clamp-2 text-[12px] text-parchment/80">{preview.notes}</p>
            )}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="chip">{STATUS_LABEL[preview.status]}</span>
              <span className="chip">{PRIORITY_LABEL[preview.priority]}</span>
              <span className="chip">{preview.estimate}h</span>
              <span className="chip">{data.groups[preview.groupId]?.name}</span>
              {preview.assignee && (
                <span className="chip" style={{ color: USER_PROFILE[preview.assignee].accentSoft }}>
                  {USER_PROFILE[preview.assignee].name}
                </span>
              )}
              {isBlocked(data, preview) && (
                <span className="chip">
                  blocked by {preview.deps.filter((d) => data.tasks[d]?.status !== 'done').length}
                </span>
              )}
              <span className="chip ml-auto" style={{ color: 'var(--accent-soft)' }}>
                +{taskXp(preview)} XP
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Canvas controls (top-left) ─────────────────────────────────── */}
      <div className="pointer-events-auto absolute left-3 top-3 flex items-center gap-1.5">
        <div className="panel flex items-center gap-1 p-1">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              userMoved.current = true;
              setCamera({ zoom: Math.max(MIN_ZOOM, camera.zoom / 1.2) });
            }}
            title="Zoom out"
          >
            −
          </button>
          <span className="t-num w-9 text-center text-[10px] text-muted">
            {Math.round(camera.zoom * 100)}%
          </span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              userMoved.current = true;
              setCamera({ zoom: Math.min(MAX_ZOOM, camera.zoom * 1.2) });
            }}
            title="Zoom in"
          >
            +
          </button>
          <span className="mx-0.5 h-4 w-px bg-white/10" />
          <button type="button" className="btn btn-sm btn-ghost" onClick={fit} title="Fit to view (F)">
            Fit
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={clearLayout}
            title="Discard manual placement and re-run the layout"
          >
            Auto layout
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => updateSettings({ showDoneInGraph: !data.settings.showDoneInGraph })}
          >
            {data.settings.showDoneInGraph ? 'Hide done' : 'Show done'}
          </button>
        </div>
      </div>

      {linkingFrom && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2">
          <div className="panel px-3 py-1.5 text-[12px] text-cream">
            Drop on a task to make it depend on {data.tasks[linkingFrom]?.key}
          </div>
        </div>
      )}

    </div>
  );
}
