import { chromium } from '@playwright/test';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: process.env.FORJA_CHROME });
const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1440, height: 900 } });
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 300)));
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
await page.goto('http://localhost:4173/');
await page.locator('input[type="file"]').first().setInputFiles(path.resolve('tests/fixtures/clip.webm'));
await page.getByRole('slider', { name: 'Línea de tiempo' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Exportar', exact: true }).click();
await page.getByRole('button', { name: 'WebM (VP8)' }).click();
await page.getByLabel('Resolución').selectOption('480');
await page.getByLabel('Fotogramas por segundo').selectOption('24');
await page.getByRole('button', { name: 'Exportar vídeo' }).click();
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(3000);
  const label = await page.locator('[role="progressbar"]').getAttribute('aria-label').catch(() => null);
  const toast = await page.locator('[role="status"]').allTextContents().catch(() => []);
  console.log(`t=${(i+1)*3}s progress="${label}" toasts=${JSON.stringify(toast).slice(0,200)}`);
  if (toast.some(x => x.includes('exportado') || x.includes('Error') || x.includes('rror'))) break;
}
await page.screenshot({ path: '/tmp/shots/export-debug.png' });
await browser.close();
