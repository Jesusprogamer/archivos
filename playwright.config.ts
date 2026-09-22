import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E suite runs against a production build, served by `vite preview` so
 * the cross-origin isolation headers are the ones real users would get.
 *
 * `FORJA_CHROME` points at a Chromium binary when the environment already has
 * one (CI images, sandboxes); otherwise Playwright's own download is used.
 */
const executablePath = process.env['FORJA_CHROME'];

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: process.env['CI'] ? 'github' : [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    // Spanish is the product default; the suite pins a Spanish browser so the
    // assertions read like the UI. One test overrides this to check English.
    locale: 'es-ES',
    trace: 'retain-on-failure',
    // `--no-sandbox` porque estas imágenes corren como root, donde Chromium se
    // niega a arrancar con su zigoto habitual. Solo se aplica cuando el binario
    // lo pone el entorno, nunca al Chromium que Playwright se descarga.
    ...(executablePath
      ? { launchOptions: { executablePath, args: ['--no-sandbox'] } }
      : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    port: 4173,
    reuseExistingServer: !process.env['CI'],
    timeout: 240_000,
  },
});
