'use client';

import { useEffect, useState } from 'react';

import { formatClock } from '@/lib/format';
import { projectStats, userStats } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { USERS, USER_PROFILE, type ViewId } from '@/lib/types';

const VIEWS: { id: ViewId; label: string; hint: string }[] = [
  { id: 'graph', label: 'Graph', hint: 'Dependency graph' },
  { id: 'board', label: 'Board', hint: 'Status board' },
  { id: 'list', label: 'List', hint: 'Sortable table' },
  { id: 'timeline', label: 'Timeline', hint: 'Schedule and critical path' },
  { id: 'stats', label: 'Stats', hint: 'Progress, velocity, achievements' },
];

/** The user switcher — the one control the whole theme hangs off. */
function UserSwitch() {
  const data = useStore((s) => s.data);
  const active = useStore((s) => s.activeUser);
  const setActiveUser = useStore((s) => s.setActiveUser);

  return (
    <div className="flex items-center gap-2">
      {USERS.map((id) => {
        const p = USER_PROFILE[id];
        const st = userStats(data, id);
        const on = active === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActiveUser(id)}
            aria-pressed={on}
            title={`${p.name} — ${st.open} open, ${st.done} done`}
            className="flex items-center gap-2 rounded-lg px-2 py-1 transition-opacity"
            style={{ opacity: on ? 1 : 0.5 }}
          >
            <span
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[13px] font-semibold"
              style={{
                background: on ? p.accent : 'rgba(255,255,255,0.06)',
                color: on ? '#061019' : '#7b8896',
                border: `1px solid ${on ? p.accent : 'var(--line)'}`,
              }}
            >
              {p.name[0]}
            </span>
            <span className="hidden text-left leading-tight sm:block">
              <span
                className="font-semibold block text-[13px]"
                style={{ color: on ? p.accentSoft : '#9aa6b3' }}
              >
                {p.name}
              </span>
              <span className="t-num block text-[10px] text-muted">
                {st.open} open · {st.done} done
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Focus timer — start it on a task and the minutes land in that task's log. */
function FocusTimer() {
  const timer = useStore((s) => s.timer);
  const tasks = useStore((s) => s.data.tasks);
  const startTimer = useStore((s) => s.startTimer);
  const pauseTimer = useStore((s) => s.pauseTimer);
  const stopTimer = useStore((s) => s.stopTimer);
  const selectedId = useStore((s) => s.selectedId);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!timer.startedAt) return;
    const h = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(h);
  }, [timer.startedAt]);

  const total = timer.elapsed + (timer.startedAt ? Date.now() - timer.startedAt : 0);
  const task = timer.taskId ? tasks[timer.taskId] : null;
  const target = task ?? (selectedId ? tasks[selectedId] : null);

  return (
    <div className="panel flex items-center gap-2.5 px-3 py-1.5">
      <span
        className="grid h-5 w-5 place-items-center text-[13px]"
        style={{ color: timer.startedAt ? 'var(--accent)' : '#67737f' }}
      >
        ◔
      </span>
      <span
        className="t-num text-[15px] tabular-nums"
        style={{ color: timer.startedAt ? 'var(--accent-soft)' : '#8d9aa8' }}
      >
        {formatClock(total)}
      </span>
      <span className="t-label max-w-[110px] truncate">{task ? task.key : 'idle'}</span>
      {timer.startedAt ? (
        <button type="button" className="btn btn-sm btn-ghost" onClick={pauseTimer}>
          Hold
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          disabled={!target}
          onClick={() => target && startTimer(target.id)}
          title={target ? `Start on ${target.key}` : 'Select a task first'}
        >
          {timer.elapsed > 0 ? 'Resume' : 'Focus'}
        </button>
      )}
      {(timer.elapsed > 0 || timer.startedAt) && (
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => stopTimer(true)}
          title="Stop and log the time"
        >
          Log
        </button>
      )}
    </div>
  );
}

/** Whether the browser and the server's project file currently agree. */
function SyncDot() {
  const syncState = useStore((s) => s.syncState);
  const rev = useStore((s) => s.rev);
  const storageWarn = useStore((s) => s.storage) === 'ephemeral';
  const tone =
    syncState === 'offline'
      ? '#ff6a3d'
      : syncState === 'saving' || storageWarn
        ? '#f0c46a'
        : '#7fd6a8';
  const storage = useStore((s) => s.storage);
  const label =
    syncState === 'offline'
      ? 'server unreachable'
      : syncState === 'saving'
        ? 'saving…'
        : storage === 'ephemeral'
          ? `rev ${rev} · storage not durable`
          : `saved · rev ${rev}`;
  return (
    <div className="mt-0.5 flex items-center gap-1.5" title={label}>
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: tone, boxShadow: `0 0 6px ${tone}` }}
      />
      <span className="t-num text-[9px] text-muted">{label}</span>
    </div>
  );
}

/** How much of the whole project is forged, and how much is standing still. */
function ProjectMeter() {
  const data = useStore((s) => s.data);
  const activeUser = useStore((s) => s.activeUser);
  const stats = projectStats(data);
  const me = userStats(data, activeUser);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="panel hidden w-[190px] px-3 py-1.5 lg:block">
      <div className="flex items-baseline justify-between">
        <span className="t-label">Completed</span>
        <span className="t-num text-[11px] text-cream">
          {stats.done}/{stats.total}
        </span>
      </div>
      <SyncDot />
      <div className="meter mt-1">
        <i style={{ width: `${pct}%` }} />
      </div>
      <div className="t-num mt-1 flex justify-between text-[9.5px] text-muted">
        <span>{stats.blocked} blocked</span>
        <span>{me.streak}d streak</span>
      </div>
    </div>
  );
}

export function TopBar() {
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const addTask = useStore((s) => s.addTask);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const setPalette = useStore((s) => s.setPalette);
  const setHelp = useStore((s) => s.setHelp);
  const activeUser = useStore((s) => s.activeUser);

  return (
    // Everything sits in the left two thirds; the right column stays clear.
    <header className="pointer-events-auto relative z-30 px-[clamp(10px,2vw,22px)] pt-3">
      <div className="flex max-w-[calc(100%-330px)] items-start gap-4">
        <div className="pointer-events-none shrink-0">
          <h1 className="text-[19px] font-semibold leading-tight text-cream">Emberkeep</h1>
          <p className="text-[11px] text-muted">Development board</p>
        </div>

        <div className="h-9 w-px shrink-0 bg-white/10" />

        <UserSwitch />

        <div className="ml-auto flex items-center gap-2">
          <ProjectMeter />
          <FocusTimer />
        </div>
      </div>

      <div className="mt-2.5 flex max-w-[calc(100%-330px)] flex-wrap items-center gap-2">
        <nav className="panel flex items-center gap-0.5 p-1" aria-label="Views">
          {VIEWS.map((v) => {
            const on = view === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => setView(v.id)}
                title={v.hint}
                aria-current={on ? 'page' : undefined}
                className="rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  color: on ? '#061019' : '#8d9aa8',
                  background: on ? 'var(--accent)' : 'transparent',
                }}
              >
                {v.label}
              </button>
            );
          })}
        </nav>

        <div className="panel flex items-center gap-1.5 px-2 py-1">
          <span className="text-[12px] text-muted">⌕</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="w-[clamp(120px,15vw,230px)] bg-transparent text-[13px] text-cream outline-none placeholder:text-[#5d6a78]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="text-[12px] text-muted hover:text-gold"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-accent"
            onClick={() => addTask({ assignee: activeUser })}
            title="New task (N)"
          >
            + New task
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setPalette(true)} title="Command palette (⌘K)">
            ⌘K
          </button>
          <button type="button" className="btn btn-sm" disabled={!canUndo} onClick={undo} title="Undo (⌘Z)">
            ↶
          </button>
          <button type="button" className="btn btn-sm" disabled={!canRedo} onClick={redo} title="Redo (⇧⌘Z)">
            ↷
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setHelp(true)} title="Shortcuts (?)">
            ?
          </button>
        </div>
      </div>
    </header>
  );
}
