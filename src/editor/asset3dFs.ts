/**
 * Client for the dev-server 3D-asset store (see vite.config.ts `asset3dStore`).
 * Imported models are written to the repo's `asset3d/` folder and loaded back off
 * disk — so they persist reliably (no localStorage size cap) and live in a real
 * folder the dev can manage. Every call degrades gracefully to null/[]/no-op when
 * the endpoint isn't there (production build, or the file was opened via file://),
 * so the editor still works with its localStorage fallback.
 */

/** Save a model file to `asset3d/<name>`; returns its URL or null if unavailable. */
export async function saveAsset3dFile(name: string, dataBase64: string): Promise<string | null> {
  try {
    const r = await fetch('/__asset3d/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, data: dataBase64 })
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { ok?: boolean; url?: string };
    return j.ok && j.url ? j.url : null;
  } catch {
    return null;
  }
}

/** Delete `asset3d/<name>` from disk (two-way sync with the editor). */
export async function deleteAsset3dFile(name: string): Promise<void> {
  try {
    await fetch('/__asset3d/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
  } catch {
    /* no dev endpoint — nothing to delete on disk */
  }
}

/** List the model files currently in `asset3d/` — or null when the dev store is
 *  unavailable (so callers can tell "empty folder" from "no server" and avoid
 *  wrongly pruning assets). */
export async function listAsset3dFiles(): Promise<string[] | null> {
  try {
    const r = await fetch('/__asset3d/list');
    if (!r.ok) return null;
    return ((await r.json()) as { files?: string[] }).files ?? [];
  } catch {
    return null;
  }
}

/** Save the Map Editor's default design (allocations + asset metadata) to disk
 *  (`asset3d/editor-map.json`) so it survives a cookie/localStorage wipe. */
export async function saveEditorMap(data: unknown): Promise<boolean> {
  try {
    const r = await fetch('/__editor/map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    // A RESOLVED fetch is not a saved file. Served through a host that does
    // not forward `/__editor/*` (the hub without its live rewrite), the POST
    // comes back as a 404 page and this used to return as if the project had
    // been baked — the edits lived in one browser's localStorage and nowhere
    // else. Say so, loudly, where the person editing will see it.
    if (!r.ok) {
      console.error(
        `[MapEditor] disk save REFUSED (HTTP ${r.status}) — the project is NOT on disk. ` +
          'Open the game on the Vite dev server (localhost:5173) or through a hub with EMBERKEEP_LIVE=1.'
      );
      return false;
    }
    return true;
  } catch {
    /* no dev endpoint — localStorage still holds it in-session */
    return false;
  }
}

/**
 * "Apply": publish the editor's export to the WORLDS pipeline — the dev server
 * writes `assets/map/nionja-worlds.json`, then runs `ingest-worlds.mjs` and
 * `build-zones.mjs`, so `src/data/zones.json` (what the engine actually runs) is
 * regenerated from this design. Null when the endpoint isn't there (production
 * build); otherwise the server's verdict, so the editor can say what went wrong
 * rather than silently looking applied.
 */
export async function publishWorlds(doc: unknown): Promise<{ ok: boolean; error?: string } | null> {
  try {
    const r = await fetch('/__editor/worlds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    return (await r.json()) as { ok: boolean; error?: string };
  } catch {
    return null;
  }
}

/** Load the on-disk default design — null when the dev store is unavailable. */
export async function loadEditorMap(): Promise<{
  allocations?: Record<string, [string, unknown][]>;
  assets?: Record<string, unknown[]>;
  zones?: Record<string, unknown[]>;
  grids?: Record<string, unknown[]>;
  maps?: unknown[];
  baseHidden?: boolean;
} | null> {
  try {
    const r = await fetch('/__editor/map');
    if (!r.ok) return null;
    const d = (await r.json()) as unknown;
    return d && typeof d === 'object'
      ? (d as {
          allocations?: Record<string, [string, unknown][]>;
          assets?: Record<string, unknown[]>;
          zones?: Record<string, unknown[]>;
          grids?: Record<string, unknown[]>;
          maps?: unknown[];
          baseHidden?: boolean;
        })
      : null;
  } catch {
    return null;
  }
}
