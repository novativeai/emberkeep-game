'use client';

import { allTags, filterTasks } from '@/lib/selectors';
import { DEFAULT_FILTERS, useStore } from '@/lib/store';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  USERS,
  USER_PROFILE,
  type Filters,
} from '@/lib/types';

function Toggle({
  on,
  onClick,
  children,
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
      style={{
        // An active filter has to be unmistakable: a tint is not enough when it
        // can hide the entire board.
        color: on ? '#061019' : '#8d9aa8',
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
      }}
    >
      {children}
    </button>
  );
}

export function FilterBar() {
  const data = useStore((s) => s.data);
  const filters = useStore((s) => s.filters);
  const search = useStore((s) => s.search);
  const setFilter = useStore((s) => s.setFilter);
  const resetFilters = useStore((s) => s.resetFilters);
  const setVault = useStore((s) => s.setVault);

  const shown = filterTasks(data, filters, search).length;
  const total = data.order.length;
  const dirty =
    search.trim().length > 0 ||
    (Object.keys(DEFAULT_FILTERS) as (keyof Filters)[]).some((k) => filters[k] !== DEFAULT_FILTERS[k]);

  return (
    <div className="pointer-events-auto relative z-20 mt-2 flex justify-center px-[clamp(10px,2vw,26px)]">
      <div className="panel flex flex-wrap items-center gap-1.5 px-2.5 py-1.5">
        <span className="t-label mr-1">Filter</span>

        <select
          value={filters.assignee}
          onChange={(e) => setFilter('assignee', e.target.value as Filters['assignee'])}
          className="field !w-auto !py-1 !text-[11px]"
          aria-label="Filter by bearer"
        >
          <option value="all">All assignees</option>
          {USERS.map((u) => (
            <option key={u} value={u}>
              {USER_PROFILE[u].name}
            </option>
          ))}
          <option value="unassigned">Unclaimed</option>
        </select>

        <select
          value={filters.status}
          onChange={(e) => setFilter('status', e.target.value as Filters['status'])}
          className="field !w-auto !py-1 !text-[11px]"
          aria-label="Filter by state"
        >
          <option value="all">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <select
          value={filters.priority}
          onChange={(e) => setFilter('priority', e.target.value as Filters['priority'])}
          className="field !w-auto !py-1 !text-[11px]"
          aria-label="Filter by priority"
        >
          <option value="all">Any priority</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABEL[p]}
            </option>
          ))}
        </select>

        <select
          value={filters.groupId}
          onChange={(e) => setFilter('groupId', e.target.value)}
          className="field !w-auto !py-1 !text-[11px]"
          aria-label="Filter by group"
        >
          <option value="all">All groups</option>
          {Object.values(data.groups)
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.glyph} {c.name}
              </option>
            ))}
        </select>

        <select
          value={filters.tag}
          onChange={(e) => setFilter('tag', e.target.value)}
          className="field !w-auto !py-1 !text-[11px]"
          aria-label="Filter by tag"
        >
          <option value="all">Any tag</option>
          {allTags(data).map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <span className="mx-0.5 h-4 w-px bg-white/10" />

        {/*
          Ready and Blocked are opposites — holding both on can only ever match
          nothing, so selecting one clears the other.
        */}
        <Toggle
          on={filters.readyOnly}
          onClick={() => {
            const next = !filters.readyOnly;
            setFilter('readyOnly', next);
            if (next) setFilter('blockedOnly', false);
          }}
          title="Only tasks that can start now"
        >
          Ready
        </Toggle>
        <Toggle
          on={filters.blockedOnly}
          onClick={() => {
            const next = !filters.blockedOnly;
            setFilter('blockedOnly', next);
            if (next) setFilter('readyOnly', false);
          }}
          title="Only tasks waiting on something"
        >
          Blocked
        </Toggle>
        <Toggle on={filters.overdueOnly} onClick={() => setFilter('overdueOnly', !filters.overdueOnly)} title="Only tasks past their due date">
          Overdue
        </Toggle>

        <span className="mx-0.5 h-4 w-px bg-white/10" />

        <span
          className="t-num text-[10.5px]"
          style={{ color: shown === 0 && total > 0 ? '#ff8a6a' : undefined }}
        >
          {shown}/{total}
        </span>
        {dirty && (
          <button
            type="button"
            className={shown === 0 && total > 0 ? 'btn btn-sm btn-accent' : 'btn btn-sm btn-ghost'}
            onClick={resetFilters}
          >
            Clear filters
          </button>
        )}
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setVault(true)} title="Settings, groups and data">
          ⚙ Settings
        </button>
      </div>
    </div>
  );
}
