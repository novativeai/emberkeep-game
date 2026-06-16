import { defineConfig } from '@playwright/test';

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
      // The 2560x1600 canvas is miserable under SwiftShader; let headless
      // Chromium use the real GPU where one exists (falls back gracefully).
      args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist']
    }
  },
  webServer: {
    command: 'pnpm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
