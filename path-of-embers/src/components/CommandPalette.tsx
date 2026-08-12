'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { isBlocked } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { STATUSES, STATUS_LABEL, USERS, USER_PROFILE, type ViewId } from '@/lib/types';

interface Command {
  id: string;
  label: string;
  hint: string;
  group: string;
  run: () => void;
}

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const data = useStore((s) => s.data);
  const selectedId = useStore((s) => s.selectedId);
  const activeUser = useStore((s) => s.activeUser);
  const store = useStore;

  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      window.setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const s = store.getState();
    const views: { id: ViewId; label: string }[] = [
      { id: 'graph', label: 'Path — the group' },
      { id: 'board', label: 'Forge — the status board' },
      { id: 'list', label: 'Ledger — the table' },
      { id: 'timeline', label: 'Chronicle — the schedule' },
      { id: 'stats', label: 'Auguries — progress and achievements' },
    ];

    const out: Command[] = [
      ...views.map((v) => ({
        id: `view-${v.id}`,
        label: `Go to ${v.label}`,
        hint: 'view',
        group: 'Navigate',
        run: () => s.setView(v.id),
      })),
      ...USERS.map((u) => ({
        id: `user-${u}`,
        label: `Become ${USER_PROFILE[u].name}`,
        hint: USER_PROFILE[u].title,
        group: 'Assignee',
        run: () => s.setActiveUser(u),
      })),
      {
        id: 'new',
        label: 'Raise a new task',
        hint: 'creates a task assigned to you',
        group: 'Make',
        run: () => s.addTask({ assignee: activeUser }),
      },
      {
        id: 'reforge',
        label: 'Auto layout the layout',
        hint: 'discard manual node placement',
        group: 'Make',
        run: () => s.clearLayout(),
      },
      {
        id: 'undo',
        label: 'Undo',
        hint: '⌘Z',
        group: 'History',
        run: () => s.undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        hint: '⇧⌘Z',
        group: 'History',
        run: () => s.redo(),
      },
      {
        id: 'ready',
        label: 'Show only what can be started',
        hint: 'ready filter',
        group: 'Filter',
        run: () => s.setFilter('readyOnly', !s.filters.readyOnly),
      },
      {
        id: 'mine',
        label: `Show only ${USER_PROFILE[activeUser].name}'s work`,
        hint: 'bearer filter',
        group: 'Filter',
        run: () => s.setFilter('assignee', activeUser),
      },
      {
        id: 'clear',
        label: 'Clear every filter',
        hint: 'reset the sift',
        group: 'Filter',
        run: () => s.resetFilters(),
      },
      {
        id: 'vault',
        label: 'Open the Vault',
        hint: 'settings, groups, import and export',
        group: 'Project',
        run: () => s.setVault(true),
      },
      {
        id: 'help',
        label: 'Shortcuts',
        hint: '?',
        group: 'Project',
        run: () => s.setHelp(true),
      },
    ];

    if (selectedId && data.tasks[selectedId]) {
      const t = data.tasks[selectedId]!;
      out.push(
        ...STATUSES.map((st) => ({
          id: `set-${st}`,
          label: `Set ${t.key} to ${STATUS_LABEL[st]}`,
          hint: 'selected task',
          group: 'Selected',
          run: () => s.setStatus(t.id, st),
        })),
        ...USERS.map((u) => ({
          id: `assign-${u}`,
          label: `Give ${t.key} to ${USER_PROFILE[u].name}`,
          hint: 'selected task',
          group: 'Selected',
          run: () => s.assign(t.id, u),
        })),
        {
          id: 'focus-sel',
          label: `Start a focus session on ${t.key}`,
          hint: 'timer',
          group: 'Selected',
          run: () => s.startTimer(t.id),
        },
      );
    }

    for (const t of Object.values(data.tasks)) {
      out.push({
        id: `jump-${t.id}`,
        label: `${t.key} — ${t.title}`,
        hint: `${STATUS_LABEL[t.status]}${isBlocked(data, t) ? ' · blocked' : ''}`,
        group: 'Jump to',
        run: () => {
          s.select(t.id);
          s.setInspector(true);
        },
      });
    }

    return out;
  }, [data, selectedId, activeUser, store]);

  const results = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = term
      ? commands.filter((c) => `${c.label} ${c.hint} ${c.group}`.toLowerCase().includes(term))
      : commands.filter((c) => c.group !== 'Jump to');
    return list.slice(0, 40);
  }, [commands, q]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    listRef.current?.children[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const runAt = (i: number) => {
    const cmd = results[i];
    if (!cmd) return;
    cmd.run();
    setPalette(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/70 pt-[14vh] backdrop-blur-sm"
      onClick={() => setPalette(false)}
    >
      <div
        className="panel panel-accent panel-in w-[min(620px,92vw)]"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 px-3.5 py-3">
          <span className="text-gold">⌘</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Type a command, or search a task…"
            className="flex-1 bg-transparent text-[15px] text-cream outline-none placeholder:text-[#5d6a78]"
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, results.length - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                runAt(cursor);
              } else if (e.key === 'Escape') {
                setPalette(false);
              }
            }}
          />
          <span className="t-label">esc</span>
        </div>
        <div className="rule mx-3.5" />
        <ul ref={listRef} className="scroll max-h-[46vh] py-1.5">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => runAt(i)}
                className="flex w-full items-baseline gap-3 px-3.5 py-1.5 text-left"
                style={{
                  background:
                    i === cursor ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'transparent',
                }}
              >
                <span className="t-label w-[58px] shrink-0">{c.group}</span>
                <span
                  className="min-w-0 flex-1 truncate text-[13px]"
                  style={{ color: i === cursor ? 'var(--accent-soft)' : 'var(--color-parchment)' }}
                >
                  {c.label}
                </span>
                <span className="t-num shrink-0 text-[10px] text-muted">{c.hint}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="px-3.5 py-6 text-center text-[13px] italic text-muted">
              No matches.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
