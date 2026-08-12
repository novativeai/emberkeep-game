import { handle, readJson } from '@/lib/server/http';
import { ApiError, mutate } from '@/lib/server/store';
import { resolveGroup } from '@/lib/server/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/groups/:id — Body: { name?, glyph?, blurb?, order? }. */
export function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await readJson(req);
    const { stored, result } = await mutate((project) => {
      const c = project.groups[resolveGroup(project, id)]!;
      if (typeof body.name === 'string' && body.name.trim()) c.name = body.name.trim();
      if (typeof body.glyph === 'string' && body.glyph.trim()) c.glyph = body.glyph.trim().slice(0, 2);
      if (typeof body.blurb === 'string') c.blurb = body.blurb;
      if (typeof body.order === 'number') c.order = body.order;
      return c;
    });
    return { rev: stored.rev, group: result };
  });
}

/** DELETE /api/groups/:id — its tasks move to the first group. */
export function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { id } = await ctx.params;
    const { stored, result } = await mutate((project) => {
      const target = resolveGroup(project, id);
      const remaining = Object.keys(project.groups).filter((k) => k !== target);
      if (remaining.length === 0) {
        throw new ApiError(409, 'the last group cannot be deleted');
      }
      const fallback = remaining[0]!;
      let moved = 0;
      for (const t of Object.values(project.tasks)) {
        if (t.groupId === target) {
          t.groupId = fallback;
          moved += 1;
        }
      }
      delete project.groups[target];
      return { deleted: target, movedTo: fallback, moved };
    });
    return { rev: stored.rev, ...result };
  });
}
