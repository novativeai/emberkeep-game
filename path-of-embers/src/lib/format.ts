export const DAY_MS = 86_400_000;

export function dayKey(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10);
}

export function todayKey(): string {
  return dayKey(Date.now());
}

export function parseDay(key: string): number {
  return new Date(`${key}T00:00:00`).getTime();
}

/** "3d ago", "in 5d", "today" — short enough to sit on a node. */
export function relativeDays(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const diff = Math.round((parseDay(iso) - new Date(dayKey(now)).getTime()) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff}d` : `${-diff}d late`;
}

export function formatHours(h: number): string {
  if (h <= 0) return '0h';
  if (h < 1) return `${Math.round(h * 60)}m`;
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function addDays(iso: string, days: number): string {
  return dayKey(parseDay(iso) + days * DAY_MS);
}

export function uid(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}
