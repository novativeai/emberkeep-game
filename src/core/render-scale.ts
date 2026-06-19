/**
 * Backing supersample factor. The coordinate space is fixed at 2560×1600, so to
 * render crisply on high-DPI / large displays we paint it into a `value`× larger
 * canvas backing. Set ONCE by `createGameConfig` at boot; every camera applies it
 * (static scenes via `setZoom`, the board folds it into its zoom math). `1` = no
 * change — so standard displays and the e2e run exactly as before.
 *
 * A mutable holder (not an `export let`) so scenes can import it without a circular
 * dependency on GameConfig (which imports the scenes).
 */
export const renderScale = { value: 1 };
