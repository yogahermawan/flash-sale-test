import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname);
const databaseUrl = process.env.E2E_DATABASE_URL ?? 'postgres://flash_sale:flash_sale@localhost:5433/flash_sale_test';
const apiPort = '3100';
const braveExecutable = '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser';
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  ?? (existsSync(braveExecutable) ? braveExecutable : undefined);

export default defineConfig({
  testDir: './frontend/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    launchOptions: executablePath ? { executablePath } : undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'pnpm -C backend migrate && pnpm -C backend dev',
      cwd: root,
      url: `http://127.0.0.1:${apiPort}/docs`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: apiPort,
        DATABASE_URL: databaseUrl,
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379',
        INTERNAL_API_KEY: 'e2e-internal-key',
        RATE_LIMIT_MAX: '10000',
      },
    },
    {
      command: 'pnpm -C frontend exec vite --host 127.0.0.1 --port 5174',
      cwd: root,
      url: 'http://127.0.0.1:5174',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${apiPort}` },
    },
  ],
});
