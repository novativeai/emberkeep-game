import { describe, expect, it } from 'vitest';

import auroraDoc from '../../src/data/aurora.json';
import snowDoc from '../../src/data/snow.json';
import weatherDoc from '../../src/data/weather.json';
import worldsDoc from '../../src/data/worlds.json';
import { validateWeatherFile, type WeatherFile } from '../../src/render/fx/weatherConfig';

const DOC = weatherDoc as unknown as WeatherFile;
const AURORA_IDS = Object.keys((auroraDoc as { presets: Record<string, unknown> }).presets);
const SNOW_IDS = Object.keys((snowDoc as { presets: Record<string, unknown> }).presets);
const WORLD_IDS = (worldsDoc as { worlds: { id: string }[] }).worlds.map((w) => w.id);

/**
 * Which world gets which sky.
 *
 * The whole point of these is that a rename cannot silently take a world's
 * weather away. BoardScene looks the preset up by name at runtime, in a world
 * the e2e tutorial never visits, and a miss is a no-op rather than a crash — so
 * without this the failure mode is "Borealis has no sky any more and nobody
 * noticed for a month".
 */
describe('weather.json', () => {
  it('validates against the presets that actually exist', () => {
    expect(validateWeatherFile(DOC, AURORA_IDS, SNOW_IDS)).toEqual([]);
  });

  it('only names worlds that exist', () => {
    for (const id of Object.keys(DOC.worlds)) expect(WORLD_IDS, id).toContain(id);
  });

  it('gives Borealis its snow, and no aurora', () => {
    // The northern lights were taken back out: the aurora band competed with
    // the snow for the same sky and read as two effects rather than weather.
    // Pinned as an exact match so re-adding one is a deliberate edit here too.
    expect(DOC.worlds.borealis).toEqual({ snow: 'snowfall' });
  });

  it('leaves the authored world alone', () => {
    // Cinder Hollow is volcanic and the tutorial runs there. Weather over the
    // tutorial would be a design change, not a rendering one.
    expect(DOC.worlds.emberkeep).toBeUndefined();
  });
});

describe('validateWeatherFile', () => {
  const base = (): WeatherFile => JSON.parse(JSON.stringify(DOC)) as WeatherFile;

  it('catches a renamed aurora preset', () => {
    const doc = base();
    doc.worlds.borealis.aurora = 'northern_lights';
    expect(validateWeatherFile(doc, AURORA_IDS, SNOW_IDS).join('\n'))
      .toMatch(/"northern_lights" is not in aurora\.json/);
  });

  it('catches a renamed snow preset', () => {
    const doc = base();
    doc.worlds.borealis.snow = 'snow';
    expect(validateWeatherFile(doc, AURORA_IDS, SNOW_IDS).join('\n'))
      .toMatch(/"snow" is not in snow\.json/);
  });

  it('rejects an entry that turns nothing on', () => {
    const doc = base();
    doc.worlds.roothold = {};
    expect(validateWeatherFile(doc, AURORA_IDS, SNOW_IDS).join('\n')).toMatch(/no effects/);
  });

  it('rejects a band outside the screen', () => {
    const doc = base();
    doc.worlds.borealis.auroraBand = 1.5;
    expect(validateWeatherFile(doc, AURORA_IDS, SNOW_IDS).join('\n')).toMatch(/auroraBand must be in \(0, 1\]/);
  });
});
