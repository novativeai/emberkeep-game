'use client';

import { useMemo, useState } from 'react';

import { formatDate, relativeDays } from '@/lib/format';
import { filterTasks, isBlocked, isOverdue, taskXp } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { STATUSES, STATUS_LABEL, USER_PROFILE, type Status, type Task } from '@/lib/types';

import { taskColor } from './TaskNode';

const COLUMN_HINT: Record<Status, string> = {
  backlog: 'Captured, not scheduled',
  ready: 'Nothing blocking it',
  active: 'Being worked on',
  review: 'Awaiting review',
  done: 'Finished',
};

function Card({ task, onDragStart }: { task: Task; onDragStart: () => void }) {
  const data = useStore((s) => s.data);
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);
  const blocked = isBlocked(data, task);
  const v = taskColor(task);
  const owner = task.assignee ? USER_PROFILE[task.assignee] : null;
  const checked = task.checklist.filter((c) => c.done).length;

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={() => select(task.id)}
      className="panel cursor-grab px-2.5 py-2 transition-transform active:cursor-grabbing"
      style={{
        boxShadow:
          selectedId === task.id
            ? `inset 0 0 0 1px ${v.main}, 0 0 22px ${'rgba(0,0,0,0.4)'}`
            : undefined,
      }}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: v.main, boxShadow: `0 0 8px ${'rgba(0,0,0,0.4)'}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="t-num text-[9.5px] text-muted">{task.key}</span>
            {task.due && (
              <span
                className="t-num text-[9.5px]"
                style={{ color: isOverdue(task) ? '#ff8a6a' : '#8d9aa8' }}
                title={formatDate(task.due)}
              >
                {relativeDays(task.due)}
              </span>
            )}
          </div>
          <h4 className="text-[13px] leading-snug text-cream">{task.title}</h4>

          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {blocked && (
              <span className="chip" title="Waiting on a dependency">
                blocked by {task.deps.filter((d) => data.tasks[d]?.status !== 'done').length}
              </span>
            )}
            {/* Developer label — the (A)/(O) the work was handed over with. */}
            <span
              className="chip gap-1 pl-0.5"
              title={owner ? owner.name : 'Unassigned'}
            >
              <span
                className="grid h-4 w-4 place-items-center rounded text-[9.5px] font-bold leading-none"
                style={{
                  background: owner ? owner.accent : 'rgba(255,255,255,0.1)',
                  color: owner ? '#061019' : '#7d8b99',
                }}
              >
                {owner ? owner.name[0] : '·'}
              </span>
              {owner ? owner.name : 'Unassigned'}
            </span>
            <span className="chip">{task.estimate}h</span>
            {task.checklist.length > 0 && (
              <span className="chip">
                ☑ {checked}/{task.checklist.length}
              </span>
            )}
            {task.tags.slice(0, 2).map((t) => (
              <span key={t} className="chip opacity-70">
                {t}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

export function BoardView() {
  const data = useStore((s) => s.data);
  const filters = useStore((s) => s.filters);
  const search = useStore((s) => s.search);
  const setStatus = useStore((s) => s.setStatus);
  const addTask = useStore((s) => s.addTask);
  const activeUser = useStore((s) => s.activeUser);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<Status | null>(null);

  const tasks = useMemo(() => filterTasks(data, filters, search), [data, filters, search]);

  const columns = useMemo(() => {
    const map = new Map<Status, Task[]>();
    for (const s of STATUSES) map.set(s, []);
    for (const t of tasks) map.get(t.status)!.push(t);
    for (const list of map.values()) {
      list.sort((a, b) => {
        const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
        return rank[a.priority] - rank[b.priority] || b.estimate - a.estimate;
      });
    }
    return map;
  }, [tasks]);

  return (
    <div className="h-full overflow-x-auto overflow-y-hidden px-[clamp(10px,2vw,26px)] pb-4">
      <div className="flex h-full gap-3">
        {STATUSES.map((s) => {
          const list = columns.get(s) ?? [];
          const hours = list.reduce((a, t) => a + t.estimate, 0);
          return (
            <section
              key={s}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(s);
              }}
              onDragLeave={() => setOver((cur) => (cur === s ? null : cur))}
              onDrop={() => {
                if (dragId) setStatus(dragId, s);
                setDragId(null);
                setOver(null);
              }}
              className="flex h-full w-[clamp(210px,17vw,270px)] shrink-0 flex-col"
            >
              <header
                className="panel mb-2 px-3 py-2"
                style={{
                  boxShadow:
                    over === s
                      ? 'inset 0 0 0 1px var(--accent), 0 0 26px var(--accent-glow)'
                      : undefined,
                }}
              >
                <div className="flex items-baseline justify-between">
                  <h3 className="font-semibold text-[12px] text-cream">{STATUS_LABEL[s]}</h3>
                  <span className="t-num text-[11px] text-muted">
                    {list.length} · {hours}h
                  </span>
                </div>
                <p className="mt-0.5 text-[10.5px] italic text-muted">{COLUMN_HINT[s]}</p>
              </header>

              <div className="scroll flex-1 space-y-2 pr-1">
                {list.map((t) => (
                  <Card key={t.id} task={t} onDragStart={() => setDragId(t.id)} />
                ))}
                {list.length === 0 && (
                  <div className="panel panel grid h-20 place-items-center text-[11.5px] italic text-muted">
                    empty
                  </div>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm w-full"
                  onClick={() => addTask({ status: s, assignee: activeUser })}
                >
                  + add here
                </button>
              </div>

              <footer className="t-num mt-2 text-center text-[10px] text-muted">
                {list.reduce((a, t) => a + taskXp(t), 0)} xp in column
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
