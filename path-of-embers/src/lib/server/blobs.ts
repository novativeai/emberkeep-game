import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { deleteObject, getObject, isR2Configured, putObject } from './r2';

/**
 * File bodies: R2 when it is configured, local disk otherwise.
 *
 * The disk path exists so `pnpm dev` supports attachments out of the box. It is
 * NOT durable on a serverless host — configure R2 for anything deployed.
 */

const FILE_DIR =
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME
    ? path.join(os.tmpdir(), 'emberkeep', 'files')
    : path.join(process.cwd(), 'data', 'files');

/** Object keys are app-generated, but never let one escape the directory. */
function diskPath(key: string): string {
  const safe = key.replace(/\.\./g, '').replace(/^\/+/, '');
  return path.join(FILE_DIR, safe);
}

export function storageBackend(): 'r2' | 'disk' {
  return isR2Configured() ? 'r2' : 'disk';
}

export async function putFile(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  if (isR2Configured()) {
    await putObject(key, body, contentType);
    return;
  }
  const dest = diskPath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, body);
  await fs.writeFile(`${dest}.type`, contentType, 'utf8');
}

export async function getFile(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  if (isR2Configured()) return getObject(key);
  try {
    const dest = diskPath(key);
    const body = await fs.readFile(dest);
    const contentType = await fs
      .readFile(`${dest}.type`, 'utf8')
      .catch(() => 'application/octet-stream');
    return { body: new Uint8Array(body), contentType };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

export async function deleteFile(key: string): Promise<void> {
  if (isR2Configured()) {
    await deleteObject(key);
    return;
  }
  const dest = diskPath(key);
  await fs.rm(dest, { force: true });
  await fs.rm(`${dest}.type`, { force: true });
}
