import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, fixture, openFiles, watchForErrors } from './helpers';

/**
 * Decodes a downloaded image inside the browser and reads one pixel.
 *
 * Checking the alpha channel of the real exported file is the only way to
 * prove the background actually came out transparent, rather than merely
 * looking transparent in the preview.
 */
async function pixelAt(
  page: Page,
  filePath: string,
  mime: string,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  const base64 = (await readFile(filePath)).toString('base64');
  return page.evaluate(
    async ({ data, type, px, py }) => {
      const response = await fetch(`data:${type};base64,${data}`);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(bitmap, 0, 0);
      const pixel = context.getImageData(px, py, 1, 1).data;
      bitmap.close();
      return [pixel[0], pixel[1], pixel[2], pixel[3]] as [number, number, number, number];
    },
    { data: base64, type: mime, px: x, py: y },
  );
}

async function openImageEditor(page: Page, file = 'greenscreen.png') {
  await page.goto('/');
  await openFiles(page, [file]);
  await page.getByRole('button', { name: 'Imagen', exact: true }).first().click();
  // Wait for the picture to be decoded and the editor to appear.
  await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible();
}

async function exportPng(page: Page) {
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar imagen' }).click();
  return download;
}

test.describe('Image editor', () => {
  test('removes a flat background by colour and exports real transparency', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openImageEditor(page);

    // The fixture is a green field with a red square in the middle.
    await page.getByLabel('Color (hex)').fill('#00b140');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportPng(page);
    const path = await file.path();
    expect(file.suggestedFilename()).toBe('greenscreen.png');

    // Corner was green: gone. Centre was the red square: kept, still red.
    const corner = await pixelAt(page, path, 'image/png', 4, 4);
    expect(corner[3]).toBe(0);
    const centre = await pixelAt(page, path, 'image/png', 200, 150);
    expect(centre[3]).toBe(255);
    expect(centre[0]).toBeGreaterThan(150);
    expectNoErrors(errors);
  });

  test('tolerance decides how much is removed', async ({ page }) => {
    await openImageEditor(page);
    await page.getByLabel('Color (hex)').fill('#00b140');

    // At zero tolerance only an exact match goes; the fixture is flat, so the
    // background still disappears — but a nearby colour must not.
    await page.getByLabel('Tolerancia', { exact: true }).first().fill('0');
    await page.getByLabel('Color (hex)').fill('#00c896');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportPng(page);
    const corner = await pixelAt(page, await file.path(), 'image/png', 4, 4);
    expect(corner[3]).toBe(255);
  });

  test('the brush erases, and undo brings it back', async ({ page }) => {
    await openImageEditor(page);
    await page.getByRole('button', { name: 'Pincel', exact: true }).click();

    const canvas = page.locator('canvas').last();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByRole('button', { name: 'Deshacer' })).toBeEnabled();

    const erased = await exportPng(page);
    const centre = await pixelAt(page, await erased.path(), 'image/png', 200, 150);
    expect(centre[3]).toBeLessThan(255);

    await page.getByRole('button', { name: 'Deshacer' }).click();
    const restored = await exportPng(page);
    const back = await pixelAt(page, await restored.path(), 'image/png', 200, 150);
    expect(back[3]).toBe(255);
  });

  test('cropping changes the exported dimensions', async ({ page }) => {
    await openImageEditor(page, 'photo.png');
    await page.getByRole('button', { name: 'Recortar', exact: true }).click();
    await page.getByLabel('Proporción').selectOption('1:1');
    // A square crop of a 640x480 image is 480x480.
    await expect(page.getByText('480 × 480 px')).toBeVisible();
    await page.getByRole('button', { name: 'Recortar', exact: true }).last().click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect(page.getByText('480 × 480 px')).toBeVisible();
  });

  test('rotating swaps width and height, and carries the cut-out with it', async ({ page }) => {
    await openImageEditor(page);
    await page.getByLabel('Color (hex)').fill('#00b140');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await page.getByRole('button', { name: 'Girar', exact: true }).click();
    await page.getByRole('button', { name: 'Girar a la derecha' }).click();

    const file = await exportPng(page);
    // The fixture is 400x300, so a quarter turn gives 300x400.
    const corner = await pixelAt(page, await file.path(), 'image/png', 4, 4);
    expect(corner[3]).toBe(0);
    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect(page.getByText('300 × 400 px')).toBeVisible();
  });

  test('JPG export fills transparency with the chosen colour', async ({ page }) => {
    await openImageEditor(page);
    await page.getByLabel('Color (hex)').fill('#00b140');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByRole('button', { name: 'JPG' }).click();
    await expect(page.getByText('JPG no admite transparencia')).toBeVisible();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Descargar imagen' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('greenscreen.jpg');

    const corner = await pixelAt(page, await file.path(), 'image/jpeg', 4, 4);
    expect(corner[3]).toBe(255);
    // White by default, not black, and certainly not still green.
    expect(corner[0]).toBeGreaterThan(240);
    expect(corner[1]).toBeGreaterThan(240);
  });

  test('a new backdrop colour shows up behind the subject in the export', async ({ page }) => {
    await openImageEditor(page);
    await page.getByLabel('Color (hex)').fill('#00b140');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await page.getByRole('button', { name: 'Fondo', exact: true }).click();
    await page.getByRole('group', { name: 'Fondo nuevo' }).getByRole('button', { name: 'Color' }).click();
    await page.getByRole('button', { name: '#1f6feb' }).click();

    const file = await exportPng(page);
    const corner = await pixelAt(page, await file.path(), 'image/png', 4, 4);
    expect(corner[3]).toBe(255);
    expect(corner).toEqual([0x1f, 0x6f, 0xeb, 255]);
  });

  test('the segmentation pipeline runs a local .onnx model end to end', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openImageEditor(page);
    await page.getByRole('button', { name: 'IA', exact: true }).click();

    // A synthetic model that returns the red channel: over this fixture it
    // must keep the red square and drop the green field. That exercises
    // download-free loading, preprocessing, the ONNX session, postprocessing
    // and mask upsampling — everything but the real weights.
    await page
      .locator('input[accept=".onnx,application/octet-stream"]')
      .setInputFiles(fixture('test-model.onnx'));
    await expect(page.getByText(/Modelo local/)).toBeVisible();

    await page.getByRole('button', { name: 'Detectar el sujeto' }).click();
    await expect(page.getByText(/Analizada en/)).toBeVisible({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportPng(page);
    const path = await file.path();
    const corner = await pixelAt(page, path, 'image/png', 4, 4);
    const centre = await pixelAt(page, path, 'image/png', 200, 150);
    expect(centre[3]).toBeGreaterThan(corner[3] + 100);
    expectNoErrors(errors);
  });
});
