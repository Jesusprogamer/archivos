import { expect, test } from '@playwright/test';
import { expectNoErrors, openFiles, watchForErrors } from './helpers';

test.describe('Shell', () => {
  test('the landing page states what the app is and offers one target', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('estudio');
    await expect(page.getByText('Tus archivos no salen de este dispositivo')).toBeVisible();
    await expect(page.getByRole('button', { name: /Suelta un archivo/ })).toBeVisible();
    expectNoErrors(errors);
  });

  test('the page is cross-origin isolated, so ffmpeg can use threads', async ({ page }) => {
    await page.goto('/');
    expect(await page.evaluate(() => self.crossOriginIsolated)).toBe(true);
  });

  test('opening an image identifies it and shows what it knows', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['photo.png']);

    await expect(page.getByRole('complementary', { name: 'Biblioteca' })).toBeVisible();
    await expect(page.getByText('photo.png').first()).toBeVisible();
    // 640x480 comes from the browser decoding the file, not from the name.
    await expect(page.getByText('640 × 480')).toBeVisible();
    await expect(page.getByText('PNG', { exact: false }).first()).toBeVisible();
    expectNoErrors(errors);
  });

  test('a file with a lying extension is identified by its bytes', async ({ page }) => {
    await page.goto('/');
    // The fixture is a PNG; the app must not believe an .mp3 name.
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'trap.mp3',
      mimeType: 'audio/mpeg',
      buffer: Buffer.from(
        // A minimal but valid 1x1 PNG.
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
    await expect(page.getByText('trap.mp3').first()).toBeVisible();
    await expect(page.getByText('1 × 1')).toBeVisible();
  });

  test('an unsupported file is refused with an explanation', async ({ page }) => {
    await page.goto('/');
    await page.locator('input[type="file"]').first().setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not media at all'),
    });
    await expect(page.getByText('Ese archivo no es compatible')).toBeVisible();
  });

  test('several files land in the library and can be switched between', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['photo.png', 'tone.mp3', 'clip.mp4']);

    await expect(page.getByText('3 archivos')).toBeVisible();
    await page.getByRole('button', { name: /tone\.mp3/, exact: false }).first().click();
    await expect(page.locator('audio')).toBeVisible();
    expectNoErrors(errors);
  });

  test('an English browser gets the English interface', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'en-GB' });
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('file studio');
    await context.close();
  });

  test('language and theme can be changed and persist', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByLabel('Idioma').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

    await page.getByRole('button', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });

  test('the shortcut help opens with ? and closes with Escape', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Atajos de teclado' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
