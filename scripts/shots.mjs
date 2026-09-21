import { chromium } from '@playwright/test';
import path from 'node:path';

const out = process.env.SHOT_DIR ?? '/tmp/shots';
const browser = await chromium.launch({ executablePath: process.env.FORJA_CHROME });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'es-ES' });
const page = await ctx.newPage();

await page.goto('http://localhost:4173/');
await page.waitForTimeout(400);
await page.screenshot({ path: path.join(out, 'home-dark.png') });

const fixtures = path.resolve('tests/fixtures');
await page.locator('input[type="file"]').first().setInputFiles([
  path.join(fixtures, 'photo.png'),
  path.join(fixtures, 'tone.mp3'),
  path.join(fixtures, 'clip.mp4'),
]);
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(out, 'studio-dark.png') });

await page.getByRole('button', { name: 'Ajustes' }).click();
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'settings-dark.png') });
await page.getByRole('button', { name: 'Claro' }).click();
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(out, 'studio-light.png') });

await browser.close();
console.log('shots written to', out);
