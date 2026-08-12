import { handle, readJson } from '@/lib/server/http';
import { mutate, read } from '@/lib/server/store';
import { coerceAssignee, createTask, serialise } from '@/lib/server/tasks';
import { allTasks, isBlocked, isOverdue, isReady } from '@/lib/selectors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/tasks — list, with the same filters the interface offers.
 * ?assignee=A|O|aina|onja|unassigned &status= &priority= &group=
 * &tag= &q= &ready=true &blocked=true &overdue=true
 */
export function GET(req: Request) {
  return handle(async () => {
    const { rev, project } = await read();
    const p = new URL(req.url).searchParams;

    const assignee = p.get('assignee');
    const status = p.get('status');
    const priority = p.get('priority');
    const group = p.get('group');
    const tag = p.get('tag');
    const q = p.get('q')?.trim().toLowerCase();

    const tasks = allTasks(project).filter((t) => {
      if (assignee) {
        if (assignee.toLowerCase() === 'unassigned') {
          if (t.assignee !== null) return false;
        } else if (t.assignee !== coerceAssignee(assignee)) {
          return false;
        }
      }
      if (status && t.status !== status.toLowerCase()) return false;
      if (priority && t.priority !== priority.toLowerCase()) return false;
      if (group) {
        const c = project.groups[t.groupId];
        const want = group.toLowerCase();
        if (t.groupId.toLowerCase() !== want && c?.name.toLowerCase() !== want) {
          return false;
        }
      }
      if (tag && !t.tags.includes(tag.toLowerCase())) return false;
      if (p.get('ready') === 'true' && !isReady(project, t)) return false;
      if (p.get('blocked') === 'true' && !isBlocked(project, t)) return false;
      if (p.get('overdue') === 'true' && !isOverdue(t)) return false;
      if (q && !`${t.key} ${t.title} ${t.notes} ${t.tags.join(' ')}`.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });

    return { rev, count: tasks.length, tasks: tasks.map((t) => serialise(project, t)) };
  });
}

/**
 * POST /api/tasks — create one task.
 * Body: { title, assignee?, status?, priority?, groupId?, estimate?,
 *         due?, tags?, notes?, deps? }
 * `assignee` accepts A / O. `groupId` accepts an id or a name.
 * `deps` accepts task ids or keys like "EMB-12"; cycles are refused with 409.
 */
export function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    const { stored, result } = await mutate((project) => createTask(project, body));
    return { rev: stored.rev, task: serialise(stored.project, result) };
  });
}
