import { defineConfig } from '@playwright/test';

// The 2560x1600 canvas is miserable under pure software rendering, so we hand
// headless Chromium a real GPU path where one exists. The ANGLE backend is
// platform-specific: metal on macOS, swiftshader (the portable fallback) on
// Linux/CI where no metal/GL surface is available. Falls back gracefully.
const angleBackend = process.platform === 'darwin' ? 'metal' : 'swiftshader';

/** Overridable so two verifies can run side by side in one checkout — see the note
 *  in vite.config.ts. Both the preview server and the browser must read the SAME
 *  port, or a run silently tests whatever build the other agent left behind. */
const PORT = Number(process.env.EMBERKEEP_PREVIEW_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: the 2560x1600 canvas renders under SwiftShader in headless CI.
  // One test drives the ENTIRE tutorial — ~20 scripted beats, each waiting on real
  // tweens and camera glides — and it lands between 4 and 6.5 minutes depending on
  // the machine. At 360s it was failing on the clock rather than on behaviour, in the
  // last step, which reads exactly like a regression and is not one. The budget has
  // to sit clear of the slow end, not on it.
  timeout: 600_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  // Playwright WIPES this directory at the start of every run — a parallel run's
  // traces and failure screenshots vanish with it. Give each run its own.
  outputDir: process.env.EMBERKEEP_E2E_OUT ?? 'test-results',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--enable-gpu', `--use-angle=${angleBackend}`, '--ignore-gpu-blocklist']
    }
  },
  webServer: {
    command: 'pnpm run preview',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
