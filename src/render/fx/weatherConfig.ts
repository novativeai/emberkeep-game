/**
 * Which sky and which weather each world gets.
 *
 * The procedural sky effects are expensive to author and cheap to place, so the
 * placement is data: adding weather to a world is a `src/data/weather.json`
 * edit and nothing else, exactly like adding a chain or a tutorial step. A world
 * with no entry here builds no weather objects at all and pays nothing.
 *
 * Phaser-free so the unit test can cross-check the preset names against
 * `aurora.json` and `snow.json` in node — a renamed preset would otherwise take
 * a world's sky away silently, at runtime, in a world nobody visits in e2e.
 */

export interface WorldWeather {
  /** Preset id in `src/data/aurora.json`. */
  aurora?: string;
  /** Fraction of the screen the aurora band covers, from the top. */
  auroraBand?: number;
  /** Preset id in `src/data/snow.json`. */
  snow?: string;
}

export interface WeatherFile {
  version: number;
  worlds: Record<string, WorldWeather>;
}

export function validateWeatherFile(
  doc: WeatherFile,
  auroraIds: readonly string[],
  snowIds: readonly string[]
): string[] {
  const errors: string[] = [];
  if (doc.version !== 1) errors.push(`version must be 1, got ${String(doc.version)}`);
  for (const [world, w] of Object.entries(doc.worlds ?? {})) {
    const at = `world "${world}"`;
    if (!w.aurora && !w.snow) errors.push(`${at}: has an entry but no effects — drop it instead`);
    if (w.aurora && !auroraIds.includes(w.aurora)) {
      errors.push(`${at}: aurora preset "${w.aurora}" is not in aurora.json`);
    }
    if (w.snow && !snowIds.includes(w.snow)) {
      errors.push(`${at}: snow preset "${w.snow}" is not in snow.json`);
    }
    if (w.auroraBand !== undefined && !(w.auroraBand > 0 && w.auroraBand <= 1)) {
      errors.push(`${at}: auroraBand must be in (0, 1]`);
    }
  }
  return errors;
}
