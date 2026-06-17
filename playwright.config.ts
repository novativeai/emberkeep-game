import { defineConfig } from '@playwright/test';

// The 2560x1600 canvas is miserable under pure software rendering, so we hand
// headless Chromium a real GPU path where one exists. The ANGLE backend is
// platform-specific: metal on macOS, swiftshader (the portable fallback) on
// Linux/CI where no metal/GL surface is available. Falls back gracefully.
const angleBackend = process.platform === 'darwin' ? 'metal' : 'swiftshader';

export default defineConfig({
  testDir: 'tests/e2e',
  // Generous: the 2560x1600 canvas renders under SwiftShader in headless CI.
  timeout: 360_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--enable-gpu', `--use-angle=${angleBackend}`, '--ignore-gpu-blocklist']
    }
  },
  webServer: {
    command: 'pnpm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
