import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text()));
page.on('pageerror', (e) => console.error('[pageerror]', e.stack ?? e.message));
page.on('requestfailed', (r) => console.error('[requestfailed]', r.url(), r.failure()?.errorText));
page.on('response', (r) => { if (r.status() >= 400) console.error('[http]', r.status(), r.url()); });
await page.goto(`http://localhost:5199/${process.env.SPIKE_PAGE ?? ''}`, { waitUntil: 'domcontentloaded' });
try {
  await page.waitForFunction(() => document.getElementById('out')?.textContent?.includes('"done"'), null, {
    timeout: Number(process.env.SPIKE_TIMEOUT ?? 300000),
  });
} catch {
  console.error('[timeout] partial results follow');
}
console.log(await page.locator('#out').textContent());
await browser.close();
