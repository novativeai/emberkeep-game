'use client';

import { useMemo, useState } from 'react';

import { formatDate, formatHours, relativeDays } from '@/lib/format';
import { filterTasks, hoursLogged, isBlocked, isOverdue, taskXp } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  USERS,
  USER_PROFILE,
  type Task,
} from '@/lib/types';

type SortKey =
  | 'key'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'estimate'
  | 'spent'
  | 'due'
  | 'deps'
  | 'xp';

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 } as const;
const STATUS_RANK = { active: 0, review: 1, ready: 2, backlog: 3, done: 4 } as const;

const COLUMNS: { key: SortKey; label: string; align?: 'right'; w: string }[] = [
  { key: 'key', label: 'Star', w: '62px' },
  { key: 'title', label: 'Task', w: 'auto' },
  { key: 'status', label: 'State', w: '116px' },
  { key: 'priority', label: 'Priority', w: '108px' },
  { key: 'assignee', label: 'Assignee', w: '108px' },
  { key: 'deps', label: 'Depends on', align: 'right', w: '74px' },
  { key: 'estimate', label: 'Est', align: 'right', w: '58px' },
  { key: 'spent', label: 'Spent', align: 'right', w: '62px' },
  { key: 'due', label: 'Due', align: 'right', w: '86px' },
  { key: 'xp', label: 'XP', align: 'right', w: '54px' },
];

export function ListView() {
  const data = useStore((s) => s.data);
  const filters = useStore((s) => s.filters);
  const search = useStore((s) => s.search);
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);
  const updateTask = useStore((s) => s.updateTask);
  const setStatus = useStore((s) => s.setStatus);
  const assign = useStore((s) => s.assign);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });

  const rows = useMemo(() => {
    const list = filterTasks(data, filters, search);
    const val = (t: Task): string | number => {
      switch (sort.key) {
        case 'key':
          return t.key;
        case 'title':
          return t.title.toLowerCase();
        case 'status':
          return STATUS_RANK[t.status];
        case 'priority':
          return PRIORITY_RANK[t.priority];
        case 'assignee':
          return t.assignee ?? 'zz';
        case 'estimate':
          return t.estimate;
        case 'spent':
          return hoursLogged(t);
        case 'due':
          return t.due ?? '9999';
        case 'deps':
          return t.deps.length;
        case 'xp':
          return taskXp(t);
      }
    };
    return [...list].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      if (av === bv) return a.key.localeCompare(b.key);
      return (av > bv ? 1 : -1) * sort.dir;
    });
  }, [data, filters, search, sort]);

  const totalEst = rows.reduce((a, t) => a + t.estimate, 0);
  const totalSpent = rows.reduce((a, t) => a + hoursLogged(t), 0);

  return (
    <div className="h-full px-[clamp(10px,2vw,26px)] pb-4">
      <div className="panel flex h-full flex-col">
        <div className="scroll flex-1">
          <table className="w-full table-fixed border-collapse text-[12.5px]">
            <colgroup>
              {COLUMNS.map((c) => (
                <col key={c.key} style={{ width: c.w }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 z-10 bg-[#0a121b]/95 backdrop-blur">
              <tr>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    scope="col"
                    className="t-label cursor-pointer select-none whitespace-nowrap px-2.5 py-2.5 text-left hover:text-gold"
                    style={{ textAlign: c.align ?? 'left' }}
                    onClick={() =>
                      setSort((s) => ({ key: c.key, dir: s.key === c.key && s.dir === 1 ? -1 : 1 }))
                    }
                  >
                    {c.label}
                    {sort.key === c.key && (
                      <span className="ml-1 text-gold">{sort.dir === 1 ? '▴' : '▾'}</span>
                    )}
                  </th>
                ))}
              </tr>
              <tr>
                <td colSpan={COLUMNS.length} className="p-0">
                  <div className="rule" />
                </td>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const blocked = isBlocked(data, t);
                const owner = t.assignee ? USER_PROFILE[t.assignee] : null;
                const on = selectedId === t.id;
                return (
                  <tr
                    key={t.id}
                    onClick={() => select(t.id)}
                    className="cursor-pointer border-b border-white/5 transition-colors hover:bg-white/[0.04]"
                    style={{
                      background: on ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined,
                    }}
                  >
                    <td className="t-num whitespace-nowrap px-2.5 py-1.5 text-[10.5px] text-muted">
                      {t.key}
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5">
                        {blocked && (
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted" title="Blocked" />
                        )}
                        <span className="truncate text-cream">{t.title}</span>
                        <span className="t-label shrink-0 opacity-60">
                          {data.groups[t.groupId]?.glyph}
                        </span>
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <select
                        value={t.status}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setStatus(t.id, e.target.value as Task['status'])}
                        className="field !py-0.5 !text-[11px]"
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <select
                        value={t.priority}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => updateTask(t.id, { priority: e.target.value as Task['priority'] })}
                        className="field !py-0.5 !text-[11px]"
                      >
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>
                            {PRIORITY_LABEL[p]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <select
                        value={t.assignee ?? ''}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => assign(t.id, (e.target.value || null) as Task['assignee'])}
                        className="field !py-0.5 !text-[11px]"
                        style={{ color: owner?.accentSoft }}
                      >
                        <option value="">—</option>
                        {USERS.map((u) => (
                          <option key={u} value={u}>
                            {USER_PROFILE[u].name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="t-num px-2.5 py-1.5 text-right text-muted">
                      {t.deps.length || '—'}
                    </td>
                    <td className="t-num px-2.5 py-1.5 text-right">{t.estimate}h</td>
                    <td className="t-num px-2.5 py-1.5 text-right text-muted">
                      {formatHours(hoursLogged(t))}
                    </td>
                    <td
                      className="t-num whitespace-nowrap px-2.5 py-1.5 text-right"
                      style={{ color: isOverdue(t) ? '#ff8a6a' : undefined }}
                      title={formatDate(t.due)}
                    >
                      {t.due ? relativeDays(t.due) : '—'}
                    </td>
                    <td className="t-num px-2.5 py-1.5 text-right" style={{ color: 'var(--accent-soft)' }}>
                      {taskXp(t)}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="px-3 py-10 text-center italic text-muted">
                    Nothing matches. Loosen the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <footer className="flex items-center justify-between border-t border-white/10 px-3 py-2">
          <span className="t-label">{rows.length} tasks shown</span>
          <span className="t-num text-[11px] text-muted">
            {totalEst}h estimated · {formatHours(totalSpent)} logged
          </span>
        </footer>
      </div>
    </div>
  );
}
