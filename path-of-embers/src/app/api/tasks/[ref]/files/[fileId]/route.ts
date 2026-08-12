import { NextResponse } from 'next/server';

import { handle } from '@/lib/server/http';
import { deleteFile, getFile } from '@/lib/server/blobs';
import { ApiError, mutate, read } from '@/lib/server/store';
import { resolveTask, serialise } from '@/lib/server/tasks';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ ref: string; fileId: string }> };

/** Strips accents and anything outside ASCII for the legacy filename param. */
function asciiFallback(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\]/g, '')
      .trim() || 'download'
  );
}

/**
 * GET /api/tasks/:ref/files/:fileId — streams the object back through the app
 * with `Content-Disposition: attachment`, so the browser saves the file under
 * its original name instead of navigating to a bucket URL. The bucket stays
 * private; no public R2 link is ever handed out.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { ref, fileId } = await ctx.params;
  try {
    const { project } = await read();
    const task = resolveTask(project, ref);
    const att = task.attachments.find((a) => a.id === fileId);
    if (!att) throw new ApiError(404, `no attachment ${fileId} on ${task.key}`);

    const object = await getFile(att.key);
    if (!object) throw new ApiError(404, 'the stored file is missing from the bucket');

    return new NextResponse(object.body as unknown as BodyInit, {
      headers: {
        'content-type': att.contentType || object.contentType,
        'content-length': String(object.body.byteLength),
        /*
         * RFC 6266: `filename` must be pure ASCII — a header value with
         * accents in it gets percent-mangled in transit. The real name rides
         * in `filename*`, which every current browser prefers.
         */
        'content-disposition': `attachment; filename="${asciiFallback(att.name)}"; filename*=UTF-8''${encodeURIComponent(att.name)}`,
        'cache-control': 'private, max-age=0, must-revalidate',
      },
    });
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/tasks/:ref/files/:fileId — removes the object and the link. */
export function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const { ref, fileId } = await ctx.params;
    const { project } = await read();
    const task = resolveTask(project, ref);
    const att = task.attachments.find((a) => a.id === fileId);
    if (!att) throw new ApiError(404, `no attachment ${fileId} on ${task.key}`);

    // Drop the reference first; a stray object is cheaper than a dead link.
    const { stored, result } = await mutate((p) => {
      const t = resolveTask(p, task.id);
      t.attachments = t.attachments.filter((a) => a.id !== fileId);
      t.updatedAt = Date.now();
      return t;
    });
    await deleteFile(att.key).catch(() => undefined);

    return { rev: stored.rev, deleted: fileId, task: serialise(stored.project, result) };
  });
}
