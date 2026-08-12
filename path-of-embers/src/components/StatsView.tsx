'use client';

import { useMemo } from 'react';

import { achievementsFor, type Achievement } from '@/lib/achievements';
import { formatHours } from '@/lib/format';
import { projectStats, userStats } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import { STATUS_LABEL, STATUSES, USERS, USER_PROFILE, type UserId } from '@/lib/types';

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="panel px-3 py-2.5">
      <div className="t-label">{label}</div>
      <div className="t-num mt-0.5 text-[22px] leading-none" style={{ color: tone ?? 'var(--color-cream)' }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

function UserCard({ id }: { id: UserId }) {
  const data = useStore((s) => s.data);
  const active = useStore((s) => s.activeUser);
  const setActiveUser = useStore((s) => s.setActiveUser);
  const st = userStats(data, id);
  const p = USER_PROFILE[id];
  const on = active === id;

  return (
    <button
      type="button"
      onClick={() => setActiveUser(id)}
      className="panel w-full px-3.5 py-3 text-left transition-transform hover:-translate-y-0.5"
      style={{
        boxShadow: on ? `inset 0 0 0 1px ${p.accent}, 0 0 30px ${p.glow}` : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        <span className="relative grid h-12 w-12 shrink-0 place-items-center">
          <span
            className="absolute inset-0"
            style={{
                            background: `linear-gradient(150deg, ${p.accentSoft}, ${p.accentDeep})`,
              boxShadow: `0 0 26px ${p.glow}`,
            }}
          />
          <span
            className="absolute inset-[3px]"
            style={{ background: 'linear-gradient(170deg,#16283a,#070f18)' }}
          />
          <span className="font-semibold relative text-[17px]" style={{ color: p.accentSoft }}>
            {st.rank.level}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[14px]" style={{ color: p.accentSoft }}>
            {p.name}
          </div>
          <div className="text-[11px] italic text-muted">{st.rank.name}</div>
        </div>
        <div className="t-num shrink-0 text-right text-[11px] text-muted">
          {st.xp} xp
          {st.streak > 0 && (
            <div style={{ color: p.accent }}>
              {st.streak}d streak
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5" style={{ ['--accent' as string]: p.accent, ['--accent-soft' as string]: p.accentSoft, ['--accent-deep' as string]: p.accentDeep, ['--accent-glow' as string]: p.glow }}>
        <div className="meter">
          <i style={{ width: `${st.rank.progress * 100}%` }} />
        </div>
        <div className="t-num mt-1 flex justify-between text-[9.5px] text-muted">
          <span>{st.rank.into} / {st.rank.span}</span>
          <span>{st.rank.next ? `next: ${st.rank.next}` : 'apex'}</span>
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-4 gap-2 text-center">
        {[
          ['done', st.done],
          ['open', st.open],
          ['in progress', st.active],
          ['blocked', st.blocked],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dd className="t-num text-[15px] text-cream">{v as number}</dd>
            <dt className="t-label">{k as string}</dt>
          </div>
        ))}
      </dl>
      <div className="t-num mt-2 text-[10px] text-muted">
        {formatHours(st.hours)} logged · {formatHours(st.estimateOpen)} still estimated
        {st.overdue > 0 && <span className="text-lava"> · {st.overdue} overdue</span>}
      </div>
    </button>
  );
}

function VelocityChart() {
  const data = useStore((s) => s.data);
  const stats = useMemo(() => projectStats(data), [data]);
  const max = Math.max(1, ...stats.velocity.map((v) => v.count));

  return (
    <div className="panel px-3.5 py-3">
      <div className="t-label mb-2">Velocity — tasks completed per week</div>
      <div className="flex h-[104px] items-end gap-2">
        {stats.velocity.map((v) => (
          <div key={v.week} className="flex flex-1 flex-col items-center gap-1">
            <span className="t-num text-[10px] text-muted">{v.count || ''}</span>
            <div
              className="w-full transition-[height] duration-500"
              style={{
                height: `${(v.count / max) * 76}px`,
                minHeight: v.count ? 3 : 1,
                background: v.count
                  ? 'linear-gradient(180deg, var(--accent-soft), var(--accent-deep))'
                  : 'rgba(255,255,255,0.07)',
                boxShadow: v.count ? '0 0 14px var(--accent-glow)' : undefined,
                clipPath: 'polygon(0 3px, 3px 0, calc(100% - 3px) 0, 100% 3px, 100% 100%, 0 100%)',
              }}
            />
            <span className="t-num text-[9px] text-muted">{v.week}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function BurndownChart() {
  const data = useStore((s) => s.data);
  const stats = useMemo(() => projectStats(data), [data]);
  const pts = stats.burndown;
  const max = Math.max(1, ...pts.map((p) => p.remaining));
  const W = 520;
  const H = 104;

  const path = pts
    .map((p, i) => {
      const x = (i / Math.max(1, pts.length - 1)) * W;
      const y = H - (p.remaining / max) * H;
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <div className="panel px-3.5 py-3">
      <div className="t-label mb-2">Burndown — hours remaining</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-[104px] w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="burn" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.34" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`${path} L ${W} ${H} L 0 ${H} Z`} fill="url(#burn)" />
        <path
          d={path}
          fill="none"
          stroke="var(--accent-soft)"
          strokeWidth="1.8"
          vectorEffect="non-scaling-stroke"
          style={{ filter: 'drop-shadow(0 0 6px var(--accent-glow))' }}
        />
      </svg>
      <div className="t-num mt-1 flex justify-between text-[9.5px] text-muted">
        <span>{pts[0]?.day}</span>
        <span>{Math.round(pts[pts.length - 1]?.remaining ?? 0)}h remaining</span>
        <span>{pts[pts.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function Achievements() {
  const data = useStore((s) => s.data);
  const user = useStore((s) => s.activeUser);
  const achievements = useMemo(() => achievementsFor(data, user), [data, user]);
  const earned = achievements.filter((b: Achievement) => b.earned).length;

  return (
    <div className="panel px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="t-label">Achievements — {USER_PROFILE[user].name}</span>
        <span className="t-num text-[10px] text-muted">
          {earned} / {achievements.length}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {achievements.map((b: Achievement) => (
          <div
            key={b.id}
            className="flex flex-col items-center gap-1 py-1 text-center"
            title={`${b.blurb} — ${b.detail}`}
            style={{ opacity: b.earned ? 1 : 0.45 }}
          >
            <span
              className="grid h-9 w-9 place-items-center rounded-lg text-[13px] font-semibold"
              style={{
                background: b.earned ? 'var(--accent)' : 'rgba(255,255,255,0.06)',
                color: b.earned ? '#061019' : '#6d7a87',
                border: '1px solid var(--line)',
              }}
            >
              {b.earned ? '✓' : '·'}
            </span>
            <span className="text-[10.5px] font-medium text-parchment">{b.name}</span>
            {!b.earned && <span className="t-num text-[9px] text-muted">{b.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function StatsView() {
  const data = useStore((s) => s.data);
  const stats = useMemo(() => projectStats(data), [data]);
  const pct = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div className="scroll h-full px-[clamp(10px,2vw,26px)] pb-6">
      <div className="mx-auto max-w-[1180px] space-y-3">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Done" value={`${pct}%`} sub={`${stats.done} of ${stats.total}`} tone="var(--accent-soft)" />
          <Tile label="Ready" value={String(stats.ready)} sub="nothing in the way" />
          <Tile label="Blocked" value={String(stats.blocked)} sub="waiting upstream" tone={stats.blocked ? '#9aa6b3' : undefined} />
          <Tile label="Overdue" value={String(stats.overdue)} sub="past their due date" tone={stats.overdue ? '#ff8a6a' : undefined} />
          <Tile label="Remaining" value={`${stats.estimateTotal - stats.estimateDone}h`} sub={`of ${stats.estimateTotal}h estimated`} />
          <Tile label="Logged" value={formatHours(stats.hoursLogged)} sub="across both assignees" />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {USERS.map((u) => (
            <UserCard key={u} id={u} />
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <VelocityChart />
          <BurndownChart />
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="panel px-3.5 py-3">
            <div className="t-label mb-2">Groups</div>
            <ul className="space-y-2">
              {stats.byGroup.map((c) => (
                <li key={c.id}>
                  <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
                    <span className="text-parchment">{c.name}</span>
                    <span className="t-num text-muted">
                      {c.done}/{c.total}
                    </span>
                  </div>
                  <div className="meter">
                    <i style={{ width: `${c.total ? (c.done / c.total) * 100 : 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="panel px-3.5 py-3">
            <div className="t-label mb-2">Status breakdown</div>
            <ul className="space-y-2">
              {STATUSES.map((s) => {
                const n = stats.byStatus[s];
                return (
                  <li key={s}>
                    <div className="mb-1 flex items-baseline justify-between text-[11.5px]">
                      <span className="text-parchment">{STATUS_LABEL[s]}</span>
                      <span className="t-num text-muted">{n}</span>
                    </div>
                    <div className="meter">
                      <i style={{ width: `${stats.total ? (n / stats.total) * 100 : 0}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stats.tagCloud.slice(0, 12).map((t) => (
                <span key={t.tag} className="chip">
                  {t.tag} <span className="t-num opacity-60">{t.count}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <Achievements />
      </div>
    </div>
  );
}
