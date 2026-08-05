#!/usr/bin/env node
/**
 * `pnpm verify` in an ISOLATED lane, so several agents can verify the same
 * checkout at the same time.
 *
 * The trap this exists to close: `vite preview` and Playwright default to ONE
 * port and ONE `dist`. With `reuseExistingServer` on (everything but CI), the
 * second run does not start its own server — it silently attaches to the first
 * one and drives the OTHER lane's build. Nothing errors. The run just fails
 * somewhere random, in code neither side touched, and both agents go hunting a
 * regression that does not exist. (Observed: five runs of the same suite dying
 * at five different beats.)
 *
 * A lane is a port + a dist + an output dir, all derived from one id:
 *   pnpm verify:lane            → id from the PID, unique per run
 *   pnpm verify:lane claude     → a named lane you can re-enter (same dist, warm)
 *
 * Both variables must agree between the preview server and the browser, which is
 * exactly the thing that is easy to get half-right by hand — hence a script
 * rather than a line in the README.
 */
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
// A flag is never a lane name: `--print` (show the lane and stop) exists so this
// can be inspected without accidentally launching a 10-minute suite.
const printOnly = args.includes('--print') || args.includes('--help');
const raw = args.find((a) => !a.startsWith('-')) ?? String(process.pid);
// Anything that is safe in a directory name; the port comes from a stable hash of
// it, so a named lane always lands on the same port instead of a fresh one.
const lane = raw.replace(/[^a-zA-Z0-9_-]/g, '').replace(/^-+/, '').slice(0, 24) || String(process.pid);
let hash = 0;
for (const ch of lane) hash = (hash * 31 + ch.charCodeAt(0)) % 900;
const port = 4300 + hash; // clear of vite's 4173 default, so a plain `pnpm verify` can run too

// All four, or the lane leaks: the port and dist decide WHICH BUILD the browser
// reads, the output dir holds this run's traces (Playwright wipes it at start,
// taking the other lane's failure evidence with it), and the shots dir is where
// the suite writes its screenshots.
const env = {
  ...process.env,
  EMBERKEEP_PREVIEW_PORT: String(port),
  EMBERKEEP_DIST: `dist-${lane}`,
  EMBERKEEP_E2E_OUT: `test-results-${lane}`,
  EMBERKEEP_E2E_SHOTS: `tests/e2e/shots-${lane}`
};

console.log(
  `[verify:lane] lane="${lane}"  port=${port}  dist=dist-${lane}  out=test-results-${lane}  shots=tests/e2e/shots-${lane}`
);
if (printOnly) {
  console.log('[verify:lane] --print: nothing run. Drop the flag to verify in this lane.');
  process.exit(0);
}
const run = spawnSync('pnpm', ['run', 'verify'], { stdio: 'inherit', env });
// dist-*/ and test-results-*/ are gitignored; a failed run's traces are left in
// place on purpose — that is the only copy of why it failed.
process.exit(run.status ?? 1);
