import { expect, test } from '@playwright/test';
import { expectNoErrors, openFiles, watchForErrors } from './helpers';

/** Reads the first bytes of a downloaded file, to check it is what it claims. */
async function magicBytes(path: string, length = 12): Promise<Buffer> {
  const { open } = await import('node:fs/promises');
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, 0);
    return buffer;
  } finally {
    await handle.close();
  }
}

test.describe('Converter', () => {
  test('converts a PNG to JPG with the browser encoder', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['photo.png']);

    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await page.getByRole('button', { name: /^JPEG/ }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Convertir', exact: true }).last().click();
    await expect(page.getByText('Listo')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Descargar' }).click();

    const file = await download;
    expect(file.suggestedFilename()).toBe('photo.jpg');
    const bytes = await magicBytes(await file.path());
    // JPEG's SOI marker: proof we got a real JPEG, not a renamed PNG.
    expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
    expectNoErrors(errors);
  });

  test('converts MP3 to OGG with ffmpeg.wasm', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);

    // An audio file opens in the audio editor, so switch to the converter.
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await page.getByRole('button', { name: /^OGG/ }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Convertir', exact: true }).last().click();
    // The first ffmpeg run downloads a 32 MB core, so this gets real headroom.
    await expect(page.getByText('Listo')).toBeVisible({ timeout: 150_000 });
    await page.getByRole('button', { name: 'Descargar' }).click();

    const file = await download;
    expect(file.suggestedFilename()).toBe('tone.ogg');
    const bytes = await magicBytes(await file.path());
    expect(bytes.subarray(0, 4).toString('ascii')).toBe('OggS');
    expectNoErrors(errors);
  });

  test('extracts the audio from a video', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['clip.mp4']);
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await page.getByRole('button', { name: /^MP3/ }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Convertir', exact: true }).last().click();
    await expect(page.getByText('Listo')).toBeVisible({ timeout: 150_000 });
    await page.getByRole('button', { name: 'Descargar' }).click();

    const file = await download;
    expect(file.suggestedFilename()).toBe('clip.mp3');
    const bytes = await magicBytes(await file.path());
    // Either an ID3 tag or a bare MPEG frame is a valid MP3 start.
    const head = bytes.subarray(0, 3).toString('ascii');
    expect(head === 'ID3' || bytes[0] === 0xff).toBe(true);
  });

  test('converts several files at once and bundles them into a ZIP', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['photo.png', 'photo.jpg', 'photo.webp']);

    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await page.getByRole('button', { name: /^WebP/ }).click();
    await expect(page.getByRole('button', { name: /^Convertir 3 archivos/ })).toBeVisible();

    await page.getByRole('button', { name: /^Convertir 3 archivos/ }).click();
    await expect(page.getByText('Listo')).toHaveCount(3, { timeout: 90_000 });

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar todo en ZIP' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('forja.zip');
    const bytes = await magicBytes(await file.path(), 4);
    expect(bytes.subarray(0, 2).toString('ascii')).toBe('PK');
    expectNoErrors(errors);
  });

  test('a running conversion can be cancelled', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['clip.mp4']);
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await page.getByRole('button', { name: /^WebM/ }).click();
    await page.getByRole('button', { name: 'Convertir', exact: true }).last().click();

    // Cancel while it is queued or running; either way it must end cancelled.
    await page.getByRole('button', { name: 'Cancelar', exact: true }).first().click();
    await expect(page.getByText('Cancelado')).toBeVisible({ timeout: 150_000 });
  });

  test('image options offer only what the browser can really encode', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();

    // PNG has no quality slider — there is nothing to trade off.
    await expect(page.getByRole('button', { name: /^PNG/ })).toBeVisible();
    await page.getByRole('button', { name: /^PNG/ }).click();
    await expect(page.getByText('Calidad de imagen')).toBeHidden();

    await page.getByRole('button', { name: /^JPEG/ }).click();
    await expect(page.getByText('Calidad de imagen')).toBeVisible();
    await expect(page.getByText('JPG no admite transparencia')).toBeVisible();
  });
});
