import { criticalPath } from '@/lib/graph';
import { projectStats, userStats } from '@/lib/selectors';
import { handle } from '@/lib/server/http';
import { read } from '@/lib/server/store';
import { USERS } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/stats — the same numbers the Auguries view reads. */
export function GET() {
  return handle(async () => {
    const { rev, project } = await read();
    const chain = criticalPath(project.tasks)
      .map((id) => project.tasks[id])
      .filter((t) => Boolean(t))
      .map((t) => ({ key: t!.key, title: t!.title, estimate: t!.estimate, status: t!.status }));

    return {
      rev,
      project: projectStats(project),
      assignees: Object.fromEntries(USERS.map((u) => [u, userStats(project, u)])),
      criticalPath: {
        length: chain.length,
        hours: chain.reduce((a, t) => a + (t.status === 'done' ? 0 : t.estimate), 0),
        tasks: chain,
      },
    };
  });
}
