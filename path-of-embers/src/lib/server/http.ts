import { NextResponse } from 'next/server';

import { ApiError, RevConflict } from './store';

/** Every route runs through here, so failures are shaped alike and never 500. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return NextResponse.json(await fn());
  } catch (err) {
    if (err instanceof RevConflict) {
      return NextResponse.json(
        {
          error: 'revision conflict',
          detail:
            'the project changed since the revision you sent — re-read /api/project and retry',
          rev: err.current.rev,
        },
        { status: 409 },
      );
    }
    if (err instanceof ApiError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    if (err instanceof SyntaxError) {
      return NextResponse.json({ error: 'request body is not valid JSON' }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError(400, 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}
