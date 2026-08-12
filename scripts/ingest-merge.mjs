#!/usr/bin/env node
/**
 * CLI for the worldbuilder Merge-page export:
 *   node scripts/ingest-merge.mjs <export.merge.json> [--dry-run]
 * Writes chains.json + uploaded art + assets.json/anchors.json wiring.
 * (The dev-server route /__worldbuilder/merge applies the same doc live.)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMergeDoc } from './apply-merge.mjs';

const [, , file, ...flags] = process.argv;
if (!file) {
  console.error('usage: node scripts/ingest-merge.mjs <export.merge.json> [--dry-run]');
  process.exit(1);
}
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
const dryRun = flags.includes('--dry-run');
try {
  const summary = applyMergeDoc(doc, repoRoot, { dryRun });
  console.log(`[ingest-merge]${dryRun ? ' (dry-run)' : ''}`, JSON.stringify(summary, null, 2));
} catch (err) {
  console.error(`[ingest-merge] ${err.message}`);
  process.exit(1);
}
