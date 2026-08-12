import { handle, readJson } from '@/lib/server/http';
import { ApiError, mutate } from '@/lib/server/store';
import { resolveTask, serialise, setDeps } from '@/lib/server/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ ref: string }> };

/**
 * POST /api/tasks/:ref/deps — make this task wait for another.
 * Body: { dep } (id or key). Refused with 409 if it would close a loop.
 */
export function POST(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const body = await readJson(req);
    if (body.dep === undefined) throw new ApiError(400, 'dep is required');
    const { stored, result } = await mutate((project) => {
      const task = resolveTask(project, ref);
      const dep = resolveTask(project, body.dep);
      setDeps(project, task, [...task.deps, dep.id]);
      task.updatedAt = Date.now();
      return task;
    });
    return { rev: stored.rev, task: serialise(stored.project, result) };
  });
}

/** DELETE /api/tasks/:ref/deps?dep=EMB-12 — drop one dependency link. */
export function DELETE(req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref } = await ctx.params;
    const depRef = new URL(req.url).searchParams.get('dep');
    if (!depRef) throw new ApiError(400, 'dep query parameter is required');
    const { stored, result } = await mutate((project) => {
      const task = resolveTask(project, ref);
      const dep = resolveTask(project, depRef);
      task.deps = task.deps.filter((d) => d !== dep.id);
      task.updatedAt = Date.now();
      return task;
    });
    return { rev: stored.rev, task: serialise(stored.project, result) };
  });
}
