import { handle, readJson } from '@/lib/server/http';
import { uid } from '@/lib/format';
import { ApiError, mutate, read } from '@/lib/server/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/groups — with task counts, so callers can pick one. */
export function GET() {
  return handle(async () => {
    const { rev, project } = await read();
    const groups = Object.values(project.groups)
      .sort((a, b) => a.order - b.order)
      .map((c) => {
        const tasks = Object.values(project.tasks).filter((t) => t.groupId === c.id);
        return {
          ...c,
          total: tasks.length,
          done: tasks.filter((t) => t.status === 'done').length,
        };
      });
    return { rev, groups };
  });
}

/** POST /api/groups — Body: { name, glyph?, blurb? }. */
export function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (typeof body.name !== 'string' || !body.name.trim()) {
      throw new ApiError(400, 'name is required');
    }
    const { stored, result } = await mutate((project) => {
      const c = {
        id: uid('k'),
        name: (body.name as string).trim(),
        glyph: typeof body.glyph === 'string' && body.glyph.trim() ? body.glyph.trim().slice(0, 2) : '✦',
        blurb: typeof body.blurb === 'string' ? body.blurb : '',
        order: Object.keys(project.groups).length,
      };
      project.groups[c.id] = c;
      return c;
    });
    return { rev: stored.rev, group: result };
  });
}
