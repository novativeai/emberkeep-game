#!/usr/bin/env node
/**
 * Applies a worldbuilder Merge-page export to the repo:
 *   - src/data/chains.json          ← mergeRule + chains (incl. per-tier artScale)
 *   - assets/sprites/items/wb/*.png ← uploaded element art (decoded from data URLs)
 *   - src/data/assets.json          ← upserted `item_<chain>_<tier>` file entries
 *   - src/data/anchors.json         ← per-key anchors (only when non-default)
 *
 * Used two ways:
 *   CLI:  node scripts/ingest-merge.mjs <export.merge.json>
 *   Dev:  the /__worldbuilder/merge vite endpoint (vite.config.ts) POSTs here.
 *
 * Validation is strict — a bad doc throws with a human-readable message and
 * NOTHING is written (all writes happen after validation passes).
 */
import fs from 'node:fs';
import path from 'node:path';

const SLUG = /^[a-z][a-z0-9_]*$/;
const DEFAULT_ANCHOR = [0.5, 0.85];

/** Validate a merge doc; throws Error with a precise message when invalid. */
export function validateMergeDoc(doc) {
  const fail = (msg) => {
    throw new Error(`merge doc invalid: ${msg}`);
  };
  if (!doc || typeof doc !== 'object') fail('not an object');
  if (doc.version !== 1) fail(`version must be 1 (got ${doc.version})`);
  if (doc.kind !== 'emberkeep-merge') fail(`kind must be "emberkeep-merge"`);
  if (!doc.mergeRule || typeof doc.mergeRule.minGroup !== 'number') fail('mergeRule.minGroup missing');
  if (!Array.isArray(doc.chains) || doc.chains.length === 0) fail('chains must be a non-empty array');

  const chainIds = new Set();
  for (const chain of doc.chains) {
    if (!SLUG.test(chain.id ?? '')) fail(`chain id "${chain.id}" must be a lowercase slug`);
    if (chainIds.has(chain.id)) fail(`duplicate chain id "${chain.id}"`);
    chainIds.add(chain.id);
    if (!chain.name || typeof chain.name !== 'string') fail(`chain "${chain.id}" needs a name`);
    if (!Array.isArray(chain.tiers) || chain.tiers.length === 0) fail(`chain "${chain.id}" has no tiers`);
    chain.tiers.forEach((tier, index) => {
      if (tier.tier !== index + 1) fail(`chain "${chain.id}" tiers must be contiguous from 1 (tier ${tier.tier} at position ${index})`);
      if (tier.id !== `${chain.id}_${tier.tier}`) fail(`tier id "${tier.id}" must be "${chain.id}_${tier.tier}"`);
      if (!tier.name || typeof tier.name !== 'string') fail(`tier "${tier.id}" needs a name`);
      if (typeof tier.sell !== 'number' || tier.sell < 0) fail(`tier "${tier.id}" sell must be a number ≥ 0`);
      if (typeof tier.xp !== 'number' || tier.xp < 0) fail(`tier "${tier.id}" xp must be a number ≥ 0`);
      if (tier.artScale !== undefined && !(tier.artScale > 0 && tier.artScale <= 4)) fail(`tier "${tier.id}" artScale must be in (0, 4]`);
      if (tier.merge !== undefined) {
        if (!(tier.merge.group >= 2)) fail(`tier "${tier.id}" merge.group must be ≥ 2`);
        if (!(tier.merge.outputs >= 1)) fail(`tier "${tier.id}" merge.outputs must be ≥ 1`);
      }
    });
  }
  // Generator outputs may point at any chain/tier in the doc — resolve AFTER
  // all chains are known.
  for (const chain of doc.chains) {
    for (const tier of chain.tiers) {
      const gen = tier.generator;
      if (gen === undefined) continue;
      if (typeof gen.cooldownMs !== 'number' || gen.cooldownMs < 0) fail(`generator "${tier.id}" cooldownMs must be ≥ 0`);
      if (typeof gen.energyCost !== 'number' || gen.energyCost < 0) fail(`generator "${tier.id}" energyCost must be ≥ 0`);
      if (gen.produces) {
        const target = doc.chains.find((c) => c.id === gen.produces.chain);
        if (!target) fail(`generator "${tier.id}" produces unknown chain "${gen.produces.chain}"`);
        if (!target.tiers.some((t) => t.tier === gen.produces.tier)) {
          fail(`generator "${tier.id}" produces "${gen.produces.chain}" tier ${gen.produces.tier}, which doesn't exist`);
        }
      }
    }
  }
  const validKeys = new Set(doc.chains.flatMap((c) => c.tiers.map((t) => `item_${t.id}`)));
  for (const [key, art] of Object.entries(doc.art ?? {})) {
    if (!validKeys.has(key)) fail(`art key "${key}" doesn't match any chain tier`);
    if (!/^data:image\/(png|webp);base64,/.test(art.dataURL ?? '')) fail(`art "${key}" dataURL must be a base64 png/webp data URL`);
    if (art.anchor !== undefined) {
      const [ax, ay] = art.anchor;
      if (!(ax >= 0 && ax <= 1 && ay >= 0 && ay <= 1)) fail(`art "${key}" anchor out of [0,1]`);
    }
  }
}

/** Strip UI-only fields, keeping exactly what chains.json carries. */
function cleanChains(doc) {
  return {
    mergeRule: doc.mergeRule,
    chains: doc.chains.map((chain) => ({
      id: chain.id,
      name: chain.name,
      ...(chain.hatchAtTier !== undefined ? { hatchAtTier: chain.hatchAtTier } : {}),
      ...(chain.merge !== undefined ? { merge: chain.merge } : {}),
      tiers: chain.tiers.map((tier) => ({
        tier: tier.tier,
        id: tier.id,
        name: tier.name,
        sell: tier.sell,
        xp: tier.xp,
        ...(tier.sellable !== undefined ? { sellable: tier.sellable } : {}),
        ...(tier.merge !== undefined ? { merge: tier.merge } : {}),
        ...(tier.generator !== undefined ? { generator: tier.generator } : {}),
        ...(tier.artScale !== undefined ? { artScale: tier.artScale } : {})
      }))
    }))
  };
}

/**
 * Write the doc into the repo. Returns a summary. Set dryRun to validate and
 * report without touching disk.
 */
export function applyMergeDoc(doc, repoRoot, { dryRun = false } = {}) {
  validateMergeDoc(doc);

  const chainsPath = path.join(repoRoot, 'src/data/chains.json');
  const assetsPath = path.join(repoRoot, 'src/data/assets.json');
  const anchorsPath = path.join(repoRoot, 'src/data/anchors.json');
  const artDir = path.join(repoRoot, 'assets/sprites/items/wb');

  const assetsDoc = JSON.parse(fs.readFileSync(assetsPath, 'utf8'));
  const anchorsDoc = JSON.parse(fs.readFileSync(anchorsPath, 'utf8'));

  const artEntries = Object.entries(doc.art ?? {});
  const summary = {
    chains: doc.chains.length,
    tiers: doc.chains.reduce((n, c) => n + c.tiers.length, 0),
    artWritten: [],
    assetsUpserted: [],
    anchorsSet: []
  };

  for (const [key, art] of artEntries) {
    const ext = art.dataURL.startsWith('data:image/webp') ? 'webp' : 'png';
    const rel = `sprites/items/wb/${key}.${ext}`;
    if (!dryRun) {
      fs.mkdirSync(artDir, { recursive: true });
      fs.writeFileSync(path.join(repoRoot, 'assets', rel), Buffer.from(art.dataURL.split(',')[1], 'base64'));
    }
    summary.artWritten.push(rel);

    const existing = assetsDoc.images.find((entry) => entry.key === key);
    if (existing) {
      existing.source = 'file';
      existing.generator = 'item';
      existing.file = rel;
    } else {
      assetsDoc.images.push({ key, source: 'file', generator: 'item', file: rel });
    }
    summary.assetsUpserted.push(key);

    const anchor = art.anchor ?? DEFAULT_ANCHOR;
    if (anchor[0] !== DEFAULT_ANCHOR[0] || anchor[1] !== DEFAULT_ANCHOR[1]) {
      anchorsDoc.byKey[key] = anchor;
      summary.anchorsSet.push(key);
    }
  }

  if (!dryRun) {
    fs.writeFileSync(chainsPath, JSON.stringify(cleanChains(doc), null, 2) + '\n');
    fs.writeFileSync(assetsPath, JSON.stringify(assetsDoc, null, 2) + '\n');
    fs.writeFileSync(anchorsPath, JSON.stringify(anchorsDoc, null, 2) + '\n');
  }
  return summary;
}
