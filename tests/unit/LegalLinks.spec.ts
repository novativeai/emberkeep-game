import { describe, expect, it } from 'vitest';
import { LEGAL_DOCS, LEGAL_SITE, legalUrl } from '../../src/core/legalLinks';

/**
 * THE ONLY NET UNDER A CROSS-REPO LINK.
 *
 * The four documents are pages on the hub, generated from the owner's .docx by
 * `embergames/scripts/import-legal.mjs`. Renaming a slug over there would turn
 * these links into a silent 404 — nothing in this repo would fail, and nobody
 * would notice until a player opened Settings. So the slugs are named here, on
 * purpose, and a rename has to break this test before it breaks the game.
 */
describe('the policies the game links to', () => {
  it('names the four documents the hub actually publishes', () => {
    expect(LEGAL_DOCS.map((d) => d.slug)).toEqual(['terms', 'privacy', 'refund', 'cookies']);
    // Short enough to sit in one row inside the settings sheet.
    for (const doc of LEGAL_DOCS) expect(doc.label.length).toBeLessThanOrEqual(8);
  });

  it('stays on THIS origin when the hub is the one serving the game', () => {
    const loc = { origin: 'https://keepofthedragon.com', pathname: '/games/emberkeep/index.html' };
    expect(legalUrl('terms', loc)).toBe('https://keepofthedragon.com/legal/terms');
    // …including a preview deployment, which must not send a tester to production.
    const preview = { origin: 'https://ember-abc123.vercel.app', pathname: '/games/emberkeep/' };
    expect(legalUrl('privacy', preview)).toBe('https://ember-abc123.vercel.app/legal/privacy');
  });

  it('falls back to the canonical site anywhere the documents are not served', () => {
    // The dev server, `vite preview`, or index.html opened on its own: there is
    // no /legal here, and a relative link would 404 in the player's face.
    for (const pathname of ['/', '/index.html', '/?uiedit']) {
      expect(legalUrl('refund', { origin: 'http://localhost:5173', pathname })).toBe(
        `${LEGAL_SITE}/legal/refund`
      );
    }
  });
});
