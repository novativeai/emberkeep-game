import { handle, readJson } from '@/lib/server/http';
import { mutate, read } from '@/lib/server/store';
import { deleteTask, patchTask, resolveTask, serialise } from '@/lib/server/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ ref: string }> };

/** GET /api/tasks/:ref — by id or key (EMB-12). */
export function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const { rev, project } = await read();
    return { rev, task: serialise(project, resolveTask(project, ref)) };
  });
}

/** PATCH /api/tasks/:ref — partial update; any field POST accepts. */
export function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const body = await readJson(req);
    const { stored, result } = await mutate((project) =>
      patchTask(project, resolveTask(project, ref), body),
    );
    return { rev: stored.rev, task: serialise(stored.project, result) };
  });
}

/** DELETE /api/tasks/:ref — also strips it from every other task's deps. */
export function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const { stored, result } = await mutate((project) => {
      const task = resolveTask(project, ref);
      deleteTask(project, task);
      return { id: task.id, key: task.key };
    });
    return { rev: stored.rev, deleted: result };
  });
}
