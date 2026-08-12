'use client';

import { useStore } from './store';
import type { ProjectData, UserId } from './types';

/** Client helpers for task file attachments. */

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Attachment writes happen server-side, so pull the authoritative copy back. */
async function refresh(): Promise<void> {
  const res = await fetch('/api/project', { cache: 'no-store' });
  if (!res.ok) return;
  const payload = (await res.json()) as { rev: number; project: ProjectData };
  useStore.getState().applyServerProject(payload.project, payload.rev);
}

export async function uploadAttachment(
  taskKey: string,
  file: File,
  by: UserId,
): Promise<boolean> {
  const form = new FormData();
  form.append('file', file);
  form.append('by', by);
  try {
    const res = await fetch(`/api/tasks/${encodeURIComponent(taskKey)}/files`, {
      method: 'POST',
      body: form,
    });
    const payload = (await res.json()) as { error?: string };
    if (!res.ok) {
      useStore.getState().pushToast(payload.error ?? 'Upload failed.', 'bad');
      return false;
    }
    await refresh();
    useStore.getState().pushToast(`${file.name} attached.`, 'good');
    return true;
  } catch {
    useStore.getState().pushToast('Upload failed — is the server reachable?', 'bad');
    return false;
  }
}

/**
 * Pulls the bytes through the API and saves them via a blob URL, so the file
 * lands in the downloads folder rather than opening a bucket link in a tab.
 */
export async function downloadAttachment(
  taskKey: string,
  fileId: string,
  name: string,
): Promise<void> {
  try {
    const res = await fetch(
      `/api/tasks/${encodeURIComponent(taskKey)}/files/${encodeURIComponent(fileId)}`,
    );
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      useStore.getState().pushToast(payload.error ?? 'Download failed.', 'bad');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    useStore.getState().pushToast('Download failed.', 'bad');
  }
}

export async function removeAttachment(taskKey: string, fileId: string): Promise<void> {
  try {
    const res = await fetch(
      `/api/tasks/${encodeURIComponent(taskKey)}/files/${encodeURIComponent(fileId)}`,
      { method: 'DELETE' },
    );
    if (!res.ok) {
      const payload = (await res.json().catch(() => ({}))) as { error?: string };
      useStore.getState().pushToast(payload.error ?? 'Could not remove the file.', 'bad');
      return;
    }
    await refresh();
  } catch {
    useStore.getState().pushToast('Could not remove the file.', 'bad');
  }
}
