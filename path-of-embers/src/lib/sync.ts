'use client';

import { useEffect } from 'react';

import { useStore } from './store';
import type { ProjectData } from './types';

/**
 * Keeps the browser and the server's project file in step.
 *
 * The server is the source of truth. On mount we pull it; after that every
 * local data change is pushed (debounced) with the revision it was based on, so
 * a task created over the API can never be silently overwritten by a stale tab.
 * A conflict or a newer revision seen while polling pulls the server's copy in.
 */

const PUSH_DEBOUNCE_MS = 450;
const POLL_MS = 4000;

interface ProjectResponse {
  rev: number;
  updatedAt: number;
  project: ProjectData;
  storage?: 'r2' | 'disk' | 'ephemeral';
}

export function useServerSync(): void {
  useEffect(() => {
    let alive = true;
    let pushTimer: number | undefined;
    let inFlight = false;
    /** Set while we are applying the server's copy, so it is not echoed back. */
    let applyingRemote = false;
    let lastPushed: ProjectData | null = null;

    const applyRemote = (payload: ProjectResponse) => {
      applyingRemote = true;
      lastPushed = payload.project;
      useStore.getState().applyServerProject(payload.project, payload.rev);
      applyingRemote = false;
    };

    const pull = async (announce: boolean) => {
      const res = await fetch('/api/project', { cache: 'no-store' });
      if (!res.ok) throw new Error(`GET /api/project → ${res.status}`);
      const payload = (await res.json()) as ProjectResponse;
      if (!alive) return;
      if (payload.rev !== useStore.getState().rev) {
        applyRemote(payload);
        if (announce) useStore.getState().pushToast('Pulled newer changes.', 'info');
      }
      useStore.setState({ syncState: 'idle' });
    };

    const push = async () => {
      if (!alive || inFlight) return;
      const { data, rev } = useStore.getState();
      if (data === lastPushed) return;
      inFlight = true;
      useStore.setState({ syncState: 'saving' });
      try {
        const res = await fetch('/api/project', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ project: data, rev }),
        });
        if (res.status === 409) {
          await pull(true);
          return;
        }
        if (!res.ok) throw new Error(`PUT /api/project → ${res.status}`);
        const payload = (await res.json()) as ProjectResponse;
        if (!alive) return;
        lastPushed = data;
        useStore.setState({ rev: payload.rev, syncState: 'idle' });
      } catch {
        if (alive) useStore.setState({ syncState: 'offline' });
      } finally {
        inFlight = false;
        // A change that landed mid-flight still needs pushing.
        if (alive && useStore.getState().data !== lastPushed) schedulePush();
      }
    };

    const schedulePush = () => {
      window.clearTimeout(pushTimer);
      pushTimer = window.setTimeout(push, PUSH_DEBOUNCE_MS);
    };

    // Initial load, then watch for local edits.
    void (async () => {
      try {
        const res = await fetch('/api/project', { cache: 'no-store' });
        if (!res.ok) throw new Error(`GET /api/project → ${res.status}`);
        const payload = (await res.json()) as ProjectResponse;
        if (!alive) return;
        applyRemote(payload);
        useStore.setState({ loaded: true, syncState: 'idle', storage: payload.storage ?? 'disk' });
      } catch {
        // Work offline against whatever is already in the store rather than
        // showing an empty board.
        if (alive) useStore.setState({ loaded: true, syncState: 'offline' });
      }
    })();

    const unsubscribe = useStore.subscribe((state, prev) => {
      if (applyingRemote || state.data === prev.data) return;
      if (!useStore.getState().loaded) return;
      /*
       * A data change that also moved `rev` came from the server — file
       * uploads and deletes write server-side and pull the result back. Echoing
       * it straight back as a PUT would bump the revision for no reason and
       * race the next real edit, so adopt it as the baseline instead.
       */
      if (state.rev !== prev.rev) {
        lastPushed = state.data;
        return;
      }
      schedulePush();
    });

    const poll = window.setInterval(() => {
      const { syncState, data } = useStore.getState();
      // Never pull on top of an edit that has not reached the server yet.
      if (syncState === 'saving' || data !== lastPushed) return;
      void pull(true).catch(() => useStore.setState({ syncState: 'offline' }));
    }, POLL_MS);

    return () => {
      alive = false;
      unsubscribe();
      window.clearTimeout(pushTimer);
      window.clearInterval(poll);
    };
  }, []);
}
