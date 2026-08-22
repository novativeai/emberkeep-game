/**
 * What a beat checkpoint is a snapshot OF. A checkpoint is a raw save blob, so
 * it silently means something else the moment any of these move:
 *   - the tutorial's step list (the step index is persisted in the save),
 *   - SAVE_VERSION (the save schema),
 *   - chain ids and tier counts (what the pieces on the recorded board are),
 *   - the authored map and zones (where those pieces stand).
 * Every checkpoint carries this fingerprint; `pnpm beat`, `bootAtBeat` and the
 * unit test refuse a checkpoint whose fingerprint is not the current one.
 * Display strings, dialogue, events.json and art never enter it — edit those freely.
 */
const { createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

function beatsFingerprint() {
  const tutorial = JSON.parse(read('src/data/tutorial.json'));
  const chains = JSON.parse(read('src/data/chains.json'));
  const saveVersion = /export const SAVE_VERSION = (\d+)/.exec(read('src/core/Constants.ts'))?.[1] ?? '?';
  const chainShape = chains.chains.map((c) => `${c.id}:${c.tiers.map((t) => t.id).join(',')}`).sort();
  const h = createHash('sha1');
  h.update(JSON.stringify({
    steps: tutorial.steps.map((s) => s.id),
    saveVersion,
    chainShape,
    map: createHash('sha1').update(read('src/data/map.json')).digest('hex'),
    zones: createHash('sha1').update(read('src/data/zones.json')).digest('hex')
  }));
  return `${saveVersion}-${h.digest('hex').slice(0, 12)}`;
}

exports.beatsFingerprint = beatsFingerprint;
