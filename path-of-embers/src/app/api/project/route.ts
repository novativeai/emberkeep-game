import { handle, readJson } from '@/lib/server/http';
import { ApiError, read, replace, storageMode } from '@/lib/server/store';
import type { ProjectData } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/project — the whole project plus its current revision. */
export function GET() {
  return handle(async () => ({ ...(await read()), storage: storageMode() }));
}

/**
 * PUT /api/project — replace the whole project.
 * Body: { project, rev? }. Sending `rev` makes the write conditional, which is
 * how the browser avoids clobbering changes made over the API.
 */
export function PUT(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const project = (body.project ?? body) as ProjectData;
    if (!project || typeof project !== 'object' || !project.tasks || !project.order) {
      throw new ApiError(400, 'body must contain a project with tasks and order');
    }
    // Never trust a client's dependency graph: drop references to tasks that
    // are not in the payload rather than persisting a broken graph.
    for (const task of Object.values(project.tasks)) {
      task.deps = task.deps.filter((d) => Boolean(project.tasks[d]));
    }
    project.order = project.order.filter((id) => Boolean(project.tasks[id]));
    for (const id of Object.keys(project.tasks)) {
      if (!project.order.includes(id)) project.order.push(id);
    }
    const rev = typeof body.rev === 'number' ? body.rev : undefined;
    return replace(project, rev);
  });
}
