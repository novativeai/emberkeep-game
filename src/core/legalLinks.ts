/**
 * THE POLICIES THE GAME LINKS TO — and never copies.
 *
 * The four documents (Terms, Privacy, Refunds, Cookies) are authored as .docx
 * by the owner and converted into the hub's pages by
 * `embergames/scripts/import-legal.mjs`. There is exactly one copy of that
 * text, on the hub, and the game points at it: a policy transcribed twice is a
 * policy that will disagree with itself the first time one of them is edited.
 *
 * Phaser-free on purpose, like everything else a unit test needs to reach —
 * the only net against a slug renamed on the hub is a test that names them.
 */

export interface LegalDocLink {
  /** The hub's route segment: /legal/<slug>. */
  slug: string;
  /** What the settings sheet writes on the link — short, it sits in one row. */
  label: string;
}

export const LEGAL_DOCS: readonly LegalDocLink[] = [
  { slug: 'terms', label: 'Terms' },
  { slug: 'privacy', label: 'Privacy' },
  { slug: 'refund', label: 'Refunds' },
  { slug: 'cookies', label: 'Cookies' }
] as const;

/**
 * Where the documents live when THIS origin does not serve them: the dev
 * server, an e2e preview, or the built index.html opened on its own.
 *
 * Deliberately not derived from anything the hub exports — its own `SITE_URL`
 * still defaults to the old address, and a legal link that quietly points at a
 * retired host is worse than no link.
 */
export const LEGAL_SITE = 'https://keepofthedragon.com';

/**
 * THE QUESTION IS "DOES MY ORIGIN SERVE /legal", NOT "AM I IN AN IFRAME".
 *
 * The hub mounts the game under `/games/emberkeep` (its next.config's
 * GAME_PATH), so that path — not the frame relationship — is what says the
 * pages are one origin away. Asking it this way also keeps a preview
 * deployment pointing at its own preview, and works when the game is opened
 * top-level rather than framed.
 */
export function legalUrl(
  slug: string,
  loc: { origin: string; pathname: string } = window.location
): string {
  return loc.pathname.startsWith('/games/')
    ? `${loc.origin}/legal/${slug}`
    : `${LEGAL_SITE}/legal/${slug}`;
}
