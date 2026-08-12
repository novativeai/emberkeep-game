'use client';

import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';

import { NODE_H, NODE_W } from '@/lib/graph';
import { PRIORITY_LABEL, STATUS_LABEL, USER_PROFILE, type Task } from '@/lib/types';

/** Owner decides the colour; unassigned work is grey. */
export function taskColor(task: Task): { main: string; soft: string; deep: string } {
  const p = task.assignee ? USER_PROFILE[task.assignee] : null;
  return {
    main: p?.accent ?? '#7d8b99',
    soft: p?.accentSoft ?? '#b9c4cf',
    deep: p?.accentDeep ?? '#2c3945',
  };
}

const STATUS_DOT: Record<Task['status'], string> = {
  backlog: '#6b7885',
  ready: '#5fd39a',
  active: '#4fc3f7',
  review: '#e8b964',
  done: '#5fd39a',
};

const PRIORITY_DOT: Record<Task['priority'], string | null> = {
  low: null,
  normal: null,
  high: '#e8b964',
  critical: '#ff6a3d',
};

interface Props {
  task: Task;
  x: number;
  y: number;
  blocked: boolean;
  selected: boolean;
  dimmed: boolean;
  onCritical: boolean;
  isTimed: boolean;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onHandleDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onEnter: () => void;
  onLeave: () => void;
  onDoubleClick: () => void;
}

export function TaskNode({
  task,
  x,
  y,
  blocked,
  selected,
  dimmed,
  onCritical,
  isTimed,
  onPointerDown,
  onHandleDown,
  onEnter,
  onLeave,
  onDoubleClick,
}: Props) {
  const c = taskColor(task);
  const done = task.status === 'done';
  const pip = PRIORITY_DOT[task.priority];

  const style: CSSProperties = {
    left: x,
    top: y,
    width: NODE_W,
    height: NODE_H,
    marginLeft: -NODE_W / 2,
    marginTop: -NODE_H / 2,
    opacity: dimmed ? 0.28 : 1,
    ['--node-accent' as string]: c.main,
  };

  const cls = [
    'node absolute',
    selected && 'node-selected',
    done && 'node-done',
    onCritical && !done && 'node-critical',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      style={style}
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      aria-label={`${task.key} ${task.title}`}
      onPointerDown={onPointerDown}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDoubleClick();
        }
      }}
    >
      <span className="node-stripe" />

      <div className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-2.5 py-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: STATUS_DOT[task.status] }}
            title={STATUS_LABEL[task.status]}
          />
          <span className="t-num text-[10px] text-muted">{task.key}</span>
          {blocked && (
            <span className="text-[10px] text-muted" title="Waiting on an unfinished dependency">
              blocked
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {pip && (
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: pip }}
                title={PRIORITY_LABEL[task.priority]}
              />
            )}
            {/* Developer label — the (A)/(O) the work was handed over with. */}
            <span
              className="grid h-4 w-4 place-items-center rounded text-[9.5px] font-bold leading-none"
              style={{
                background: task.assignee ? c.main : 'rgba(255,255,255,0.08)',
                color: task.assignee ? '#061019' : '#7d8b99',
              }}
              title={task.assignee ? USER_PROFILE[task.assignee].name : 'Unassigned'}
            >
              {task.assignee ? USER_PROFILE[task.assignee].name[0] : '·'}
            </span>
          </span>
        </div>

        <div className="node-title line-clamp-2 text-[12.5px] font-medium leading-snug text-cream">
          {task.title}
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-muted">
          <span className="t-num">{task.estimate}h</span>
          {task.assignee && (
            <span style={{ color: c.soft }}>{USER_PROFILE[task.assignee].name}</span>
          )}
          <span className="ml-auto">{PRIORITY_LABEL[task.priority]}</span>
          {isTimed && <span style={{ color: 'var(--accent)' }}>timing</span>}
        </div>
      </div>

      {/* Drag this to draw a dependency into another task. */}
      <button
        type="button"
        onPointerDown={onHandleDown}
        aria-label={`Draw a dependency from ${task.key}`}
        title="Drag to another task to create a dependency"
        className="absolute -right-2 top-1/2 h-5 w-5 -translate-y-1/2 cursor-crosshair rounded-full transition-opacity"
        style={{ opacity: selected ? 1 : 0 }}
      >
        <span
          className="block h-2.5 w-2.5 translate-x-1 rounded-full border"
          style={{ borderColor: c.main, background: '#0c141e' }}
        />
      </button>
    </div>
  );
}
