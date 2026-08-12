import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { buildSeed } from '../seed';
import type { ProjectData } from '../types';
import { getObject, isR2Configured, putObject } from './r2';

/**
 * File-backed project store — the server is the source of truth, the browser is
 * a client of it like any other. Writes are serialised through an in-process
 * queue and land via a temp file + rename, so a crash mid-write cannot leave a
 * half-written project behind.
 *
 * `rev` increments on every write. Clients send the rev they based their edit
 * on; a mismatch is a 409, which is what stops a stale browser tab from
 * silently clobbering a task added over the API.
 */

/*
 * Serverless hosts mount the deployment read-only, so the disk fallback has to
 * live in the temp dir there. It survives only until the instance recycles —
 * configure R2 for anything that must outlive a cold start.
 */
const EPHEMERAL = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_DIR = EPHEMERAL
  ? path.join(os.tmpdir(), 'emberkeep')
  : path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'project.json');
/** Where the project lives in the bucket when R2 is configured. */
const R2_PROJECT_KEY = process.env.R2_PROJECT_KEY?.trim() || 'emberkeep/project.json';

export interface Stored {
  rev: number;
  updatedAt: number;
  project: ProjectData;
}

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every previously queued write has settled. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function parse(raw: string): Stored {
  const parsed = JSON.parse(raw) as Partial<Stored>;
  if (!parsed || !parsed.project || typeof parsed.rev !== 'number') {
    throw new Error('malformed project file');
  }
  const stored = parsed as Stored;
  // Forward-migrate projects written before a field existed, so older stored
  // copies keep loading instead of crashing on a missing array.
  for (const task of Object.values(stored.project.tasks)) {
    task.attachments ??= [];
    task.checklist ??= [];
    task.comments ??= [];
    task.logs ??= [];
    task.tags ??= [];
    task.deps ??= [];
  }
  return stored;
}

/**
 * R2 when it is configured, local disk otherwise. Serverless hosts give you a
 * read-only, per-invocation filesystem, so the bucket is what makes the project
 * survive a deploy.
 */
async function readRaw(): Promise<Stored> {
  if (isR2Configured()) {
    const found = await getObject(R2_PROJECT_KEY);
    if (found) return parse(new TextDecoder().decode(found.body));
    const seeded: Stored = { rev: 1, updatedAt: Date.now(), project: buildSeed(Date.now()) };
    await writeRaw(seeded);
    return seeded;
  }

  try {
    return parse(await fs.readFile(FILE, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const seeded: Stored = { rev: 1, updatedAt: Date.now(), project: buildSeed(Date.now()) };
    await writeRaw(seeded);
    return seeded;
  }
}

async function writeRaw(stored: Stored): Promise<void> {
  const json = JSON.stringify(stored, null, 2);
  if (isR2Configured()) {
    await putObject(R2_PROJECT_KEY, new TextEncoder().encode(json), 'application/json');
    return;
  }
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.tmp`;
  await fs.writeFile(tmp, json, 'utf8');
  await fs.rename(tmp, FILE);
}

export function read(): Promise<Stored> {
  return serial(readRaw);
}

/** How durable the current storage is — surfaced so the UI can warn. */
export function storageMode(): 'r2' | 'disk' | 'ephemeral' {
  if (isR2Configured()) return 'r2';
  return EPHEMERAL ? 'ephemeral' : 'disk';
}

/**
 * Apply `fn` to a private copy of the project and persist the result. Throwing
 * from `fn` aborts the write, leaving the stored project untouched.
 */
export function mutate<T>(
  fn: (project: ProjectData) => T,
  expectedRev?: number,
): Promise<{ stored: Stored; result: T }> {
  return serial(async () => {
    const current = await readRaw();
    if (expectedRev !== undefined && expectedRev !== current.rev) {
      throw new RevConflict(current);
    }
    const project = structuredClone(current.project);
    const result = fn(project);
    const stored: Stored = { rev: current.rev + 1, updatedAt: Date.now(), project };
    await writeRaw(stored);
    return { stored, result };
  });
}

/** Wholesale replacement — used by import and by the browser's push. */
export function replace(project: ProjectData, expectedRev?: number): Promise<Stored> {
  return serial(async () => {
    const current = await readRaw();
    if (expectedRev !== undefined && expectedRev !== current.rev) {
      throw new RevConflict(current);
    }
    const stored: Stored = { rev: current.rev + 1, updatedAt: Date.now(), project };
    await writeRaw(stored);
    return stored;
  });
}

export class RevConflict extends Error {
  readonly current: Stored;
  constructor(current: Stored) {
    super('revision conflict');
    this.name = 'RevConflict';
    this.current = current;
  }
}

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}
