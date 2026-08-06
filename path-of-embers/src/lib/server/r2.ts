import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * Cloudflare R2, wired the same way stock-ai does it: S3-compatible endpoint,
 * SigV4, region "auto". Same variable names, so one set of credentials serves
 * both projects.
 *
 *   R2_ACCOUNT_ID        (or R2_ENDPOINT_URL for the full endpoint)
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *
 * Everything here degrades cleanly: with no credentials the app falls back to
 * local disk, so `pnpm dev` works out of the box.
 */

const accountId = process.env.R2_ACCOUNT_ID?.trim();
const endpointEnv = process.env.R2_ENDPOINT_URL?.trim();
const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();

export const R2_BUCKET = process.env.R2_BUCKET_NAME?.trim() ?? '';

const endpoint =
  endpointEnv || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

export function isR2Configured(): boolean {
  return Boolean(endpoint && accessKeyId && secretAccessKey && R2_BUCKET);
}

let client: S3Client | null = null;

function s3(): S3Client {
  if (!isR2Configured()) {
    throw new Error(
      'R2 is not configured — set R2_ACCOUNT_ID (or R2_ENDPOINT_URL), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME',
    );
  }
  client ??= new S3Client({
    region: 'auto',
    endpoint,
    credentials: { accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey! },
    // R2 wants path-style addressing against the account endpoint.
    forcePathStyle: true,
  });
  return client;
}

export async function putObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || 'application/octet-stream',
    }),
  );
}

/** Returns null when the object does not exist. */
export async function getObject(
  key: string,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  try {
    const res = await s3().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    if (!res.Body) return null;
    const body = await res.Body.transformToByteArray();
    return { body, contentType: res.ContentType ?? 'application/octet-stream' };
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}
