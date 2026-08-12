import { defineConfig } from '@playwright/test';

// The 2560x1600 canvas is miserable under pure software rendering, so we hand
// headless Chromium a real GPU path where one exists. The ANGLE backend is
// platform-specific: metal on macOS, swiftshader (the portable fallback) on
// Linux/CI where no metal/GL surface is available. Falls back gracefully.
const angleBackend = process.platform === 'darwin' ? 'metal' : 'swiftshader';

/** The preview port, the dist it serves and the output dirs all come from the
 *  lane — set them together or a run silently tests the other agent's build. */
const PORT = Number(process.env.EMBERKEEP_PREVIEW_PORT ?? 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: the 2560x1600 canvas renders under SwiftShader in headless CI.
  timeout: 360_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
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
