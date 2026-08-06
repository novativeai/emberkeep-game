'use client';

import { useMemo } from 'react';

import { criticalPath, scheduleHours } from '@/lib/graph';
import { DAY_MS, addDays, dayKey, formatDate, parseDay } from '@/lib/format';
import { filterTasks } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { STATUS_LABEL, USER_PROFILE } from '@/lib/types';

import { taskColor } from './TaskNode';

const DAY_W = 26;
const ROW_H = 26;

/**
 * Earliest-start schedule: a task begins the moment its last dependency ends.
 * It is a forecast of the shape of the work, not a promise of dates — which is
 * exactly what a critical path is for.
 */
export function TimelineView() {
  const data = useStore((s) => s.data);
  const filters = useStore((s) => s.filters);
  const search = useStore((s) => s.search);
  const select = useStore((s) => s.select);
  const selectedId = useStore((s) => s.selectedId);

  const schedule = useMemo(() => scheduleHours(data.tasks), [data.tasks]);
  const critical = useMemo(() => new Set(criticalPath(data.tasks)), [data.tasks]);
  const visible = useMemo(() => filterTasks(data, filters, search), [data, filters, search]);

  const perDay = Math.max(1, data.settings.hoursPerDay);
  const start = data.settings.startDate;

  const rows = useMemo(() => {
    const groups = Object.values(data.groups)
      .sort((a, b) => a.order - b.order)
      .map((c) => ({
        group: c,
        tasks: visible
          .filter((t) => t.groupId === c.id)
          .sort((a, b) => (schedule.get(a.id)?.start ?? 0) - (schedule.get(b.id)?.start ?? 0)),
      }))
      .filter((g) => g.tasks.length > 0);
    return groups;
  }, [visible, data.groups, schedule]);

  const totalDays = useMemo(() => {
    let max = 0;
    for (const t of visible) max = Math.max(max, schedule.get(t.id)?.end ?? 0);
    return Math.max(14, Math.ceil(max / perDay) + 3);
  }, [visible, schedule, perDay]);

  const todayOffset = (parseDay(dayKey(Date.now())) - parseDay(start)) / DAY_MS;
  const width = totalDays * DAY_W;

  const finishIso = addDays(start, Math.ceil(totalDays - 3));

  return (
    <div className="h-full px-[clamp(10px,2vw,26px)] pb-4">
      <div className="panel flex h-full flex-col">
        <header className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
          <div>
            <h3 className="font-semibold text-[13px] text-cream">Timeline</h3>
            <p className="text-[11.5px] italic text-muted">
              Earliest start given every dependency, at {perDay}h a day.
            </p>
          </div>
          <div className="t-num flex gap-4 text-[11px] text-muted">
            <span>start {formatDate(start)}</span>
            <span>
              span <span className="text-cream">{totalDays - 3}d</span>
            </span>
            <span>
              lands <span style={{ color: 'var(--accent-soft)' }}>{formatDate(finishIso)}</span>
            </span>
            <span>
              critical path <span className="text-lava">{critical.size}</span> tasks
            </span>
          </div>
        </header>
        <div className="rule" />

        <div className="scroll flex-1 overflow-x-auto">
          <div className="relative" style={{ width: width + 260, minWidth: '100%' }}>
            {/* Today, drawn over every row so the forecast has a "you are here". */}
            {todayOffset >= 0 && todayOffset <= totalDays && (
              <div
                aria-hidden
                className="pointer-events-none absolute bottom-0 top-[30px] z-[5] w-px"
                style={{
                  left: 260 + todayOffset * DAY_W,
                  background: 'linear-gradient(180deg, rgba(255,233,176,0.9), rgba(255,233,176,0.15))',
                  boxShadow: '0 0 10px rgba(255,233,176,0.6)',
                }}
              >
                <span className="t-label absolute -top-[13px] left-1 whitespace-nowrap text-cream">
                  today
                </span>
              </div>
            )}
            {/* Day ruler */}
            <div className="sticky top-0 z-10 flex bg-[#0a121b]/95 backdrop-blur">
              <div className="t-label w-[260px] shrink-0 px-3 py-2">Group / task</div>
              <div className="relative h-[30px] flex-1">
                {Array.from({ length: totalDays }).map((_, d) => {
                  const iso = addDays(start, d);
                  const isWeekStart = new Date(`${iso}T00:00:00`).getDay() === 1;
                  return (
                    <div
                      key={d}
                      className="absolute top-0 h-full border-l text-[9px]"
                      style={{
                        left: d * DAY_W,
                        width: DAY_W,
                        borderColor: isWeekStart ? 'rgba(240,196,106,0.28)' : 'rgba(255,255,255,0.05)',
                      }}
                    >
                      {isWeekStart && (
                        <span className="t-num absolute left-1 top-1.5 whitespace-nowrap text-muted">
                          {iso.slice(5)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {rows.map((g) => (
              <section key={g.group.id}>
                <div className="flex items-center gap-2 bg-white/[0.03] px-3 py-1">
                  <span className="text-[12px] text-gold">{g.group.glyph}</span>
                  <h4 className="font-semibold text-[11px] text-parchment">{g.group.name}</h4>
                  <span className="t-num text-[10px] text-muted">{g.tasks.length}</span>
                </div>

                {g.tasks.map((t) => {
                  const sp = schedule.get(t.id);
                  if (!sp) return null;
                  const left = (sp.start / perDay) * DAY_W;
                  const w = Math.max(6, ((sp.end - sp.start) / perDay) * DAY_W);
                  const v = taskColor(t);
                  const crit = critical.has(t.id);
                  const dueOffset =
                    t.due !== null ? ((parseDay(t.due) - parseDay(start)) / DAY_MS) * DAY_W : null;
                  const on = selectedId === t.id;

                  return (
                    <div
                      key={t.id}
                      onClick={() => select(t.id)}
                      className="flex cursor-pointer items-center hover:bg-white/[0.04]"
                      style={{
                        height: ROW_H,
                        background: on ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : undefined,
                      }}
                    >
                      <div className="flex w-[260px] shrink-0 items-center gap-1.5 px-3">
                        <span className="t-num shrink-0 text-[9.5px] text-muted">{t.key}</span>
                        <span className="truncate text-[12px] text-parchment">{t.title}</span>
                      </div>
                      <div className="relative h-full flex-1">
                        <div
                          className="absolute top-1/2 -translate-y-1/2"
                          style={{
                            left,
                            width: w,
                            height: 13,
                            background: `linear-gradient(90deg, ${v.main}, ${v.deep})`,
                            clipPath:
                              'polygon(0 3px, 3px 0, calc(100% - 3px) 0, 100% 3px, 100% calc(100% - 3px), calc(100% - 3px) 100%, 3px 100%, 0 calc(100% - 3px))',
                            boxShadow: crit
                              ? '0 0 14px rgba(255,120,80,0.75), inset 0 0 0 1px rgba(255,180,140,0.8)'
                              : `0 0 10px ${'rgba(0,0,0,0.4)'}`,
                            opacity: t.status === 'done' ? 0.55 : 1,
                          }}
                          title={`${t.title} · ${STATUS_LABEL[t.status]} · ${t.estimate}h`}
                        />
                        {dueOffset !== null && (
                          <span
                            className="absolute top-1/2 h-[9px] w-[9px] -translate-y-1/2 rotate-45"
                            style={{
                              left: dueOffset - 4,
                              background: '#ffcb5c',
                              boxShadow: '0 0 8px rgba(255,203,92,0.9)',
                            }}
                            title={`Due ${formatDate(t.due)}`}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </section>
            ))}

          </div>
        </div>

        <footer className="flex items-center gap-4 border-t border-white/10 px-3 py-2 text-[10.5px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="block h-2 w-4" style={{ background: USER_PROFILE.aina.accent }} /> Aina
          </span>
          <span className="flex items-center gap-1.5">
            <i className="block h-2 w-4" style={{ background: USER_PROFILE.onja.accent }} /> Onja
          </span>
          <span className="flex items-center gap-1.5">
            <i
              className="block h-2 w-4"
              style={{ background: '#7a5a3a', boxShadow: '0 0 8px rgba(255,120,80,0.8)' }}
            />
            critical path
          </span>
          <span className="flex items-center gap-1.5">
            <i className="block h-2 w-2 rotate-45" style={{ background: '#ffcb5c' }} /> due date
          </span>
        </footer>
      </div>
    </div>
  );
}
