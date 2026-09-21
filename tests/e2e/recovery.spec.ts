import { expect, test } from '@playwright/test';

/**
 * Two failure modes that both look identical to a user — a black page with
 * nothing on it. Neither is allowed to stay silent.
 */
test.describe('Recovery', () => {
  test('a normal load replaces the static fallback with the real app', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#boot-fallback')).toHaveCount(0);
  });

  test('without JavaScript the page explains itself instead of going black', async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, locale: 'es-ES' });
    const page = await context.newPage();
    await page.goto('/');

    const fallback = page.locator('#boot-fallback');
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText('Forja no ha podido arrancar');
    await expect(fallback).toContainText('npm run dev');
    await context.close();
  });

  test('a crash inside the app shows an error screen, not an empty one', async ({ page }) => {
    // Break a browser API the workspace depends on, before any module runs,
    // so the failure happens during render rather than in a worker.
    await page.addInitScript(() => {
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        value: () => {
          throw new Error('forja e2e: getContext deliberately broken');
        },
      });
    });
    await page.goto('/');

    const crashed = page.getByRole('alert').filter({ hasText: 'Forja se ha roto' });
    const landing = page.getByRole('heading', { level: 1 });
    // Either the app survives a canvas-less browser or it says so out loud.
    await expect(crashed.or(landing).first()).toBeVisible();

    const rootText = await page.locator('#root').innerText();
    expect(rootText.trim()).not.toBe('');
  });
});
