import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, openFiles, watchForErrors } from './helpers';

/**
 * The fixtures are WebM, not MP4, on purpose.
 *
 * Chromium builds without patented codecs — which is what CI images ship —
 * cannot decode H.264 at all. Testing with WebM exercises exactly the same code
 * path and actually runs; an MP4 test would only prove which browser was used.
 */
const CLIP = 'clip.webm';

async function describeVideo(page: Page, filePath: string) {
  const { readFile } = await import('node:fs/promises');
  const base64 = (await readFile(filePath)).toString('base64');
  return page.evaluate(async (data) => {
    const response = await fetch(`data:video/webm;base64,${data}`);
    const url = URL.createObjectURL(await response.blob());
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    try {
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('undecodable'));
        video.src = url;
      });
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }, base64);
}

async function openVideoEditor(page: Page, files = [CLIP]) {
  await page.goto('/');
  await openFiles(page, files);
  await expect(page.getByRole('slider', { name: 'Línea de tiempo' })).toBeVisible({
    timeout: 30_000,
  });
}

const clips = (page: Page) => page.locator('[role="button"][aria-pressed]');

test.describe('Video editor', () => {
  test('a dropped clip lands on the timeline and the preview draws it', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVideoEditor(page);

    await expect(clips(page)).toHaveCount(1);
    await expect(page.getByText(CLIP).first()).toBeVisible();
    // The preview canvas has the project's aspect ratio, drawn at half size.
    const box = await page.locator('canvas[aria-label="Vista previa"]').boundingBox();
    expect(box!.width).toBeGreaterThan(100);
    expectNoErrors(errors);
  });

  test('splitting at the playhead makes two clips out of one', async ({ page }) => {
    await openVideoEditor(page);
    await clips(page).first().click();

    // Put the playhead a third of the way along, then split.
    const ruler = page.getByRole('slider', { name: 'Línea de tiempo' });
    const box = (await ruler.boundingBox())!;
    await page.mouse.click(box.x + 30, box.y + box.height / 2);
    await page.getByRole('button', { name: 'Dividir' }).click();

    await expect(clips(page)).toHaveCount(2);
  });

  test('undo puts a split back together', async ({ page }) => {
    await openVideoEditor(page);
    await clips(page).first().click();
    const box = (await page.getByRole('slider', { name: 'Línea de tiempo' }).boundingBox())!;
    await page.mouse.click(box.x + 30, box.y + box.height / 2);
    await page.getByRole('button', { name: 'Dividir' }).click();
    await expect(clips(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Deshacer' }).click();
    await expect(clips(page)).toHaveCount(1);
  });

  test('a text clip can be added and edited', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVideoEditor(page);

    await page.getByRole('button', { name: 'Añadir texto' }).click();
    await expect(clips(page)).toHaveCount(2);

    // The new clip is selected, so its properties are on screen.
    await page.getByLabel('Contenido').fill('Hola');
    await expect(page.getByText('Hola').first()).toBeVisible();
    expectNoErrors(errors);
  });

  test('deleting removes the clip, and ripple delete closes the gap', async ({ page }) => {
    await openVideoEditor(page);
    await page.getByRole('button', { name: 'Añadir texto' }).click();
    await expect(clips(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
    await expect(clips(page)).toHaveCount(1);
  });

  test('exports a real video file, frame by frame', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVideoEditor(page);

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    // WebM keeps this honest in a Chromium with no H.264 encoder available to
    // compare against; ffmpeg.wasm encodes both, but WebM is decodable here.
    await page.getByRole('button', { name: 'WebM (VP8)' }).click();
    await page.getByLabel('Resolución').selectOption('480');
    await page.getByLabel('Fotogramas por segundo').selectOption('24');

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar vídeo' }).click();
    // Rendering frame by frame through WebAssembly is deliberately unhurried.
    const file = await download;

    expect(file.suggestedFilename()).toBe('clip-forja.webm');
    const info = await describeVideo(page, await file.path());
    // The fixture is two seconds of 320x240; exported at 480p it keeps 4:3.
    expect(info.duration).toBeGreaterThan(1.5);
    expect(info.duration).toBeLessThan(3);
    expect(info.height).toBe(480);
    expectNoErrors(errors);
  });

  test('an empty project refuses to export instead of producing a broken file', async ({ page }) => {
    await openVideoEditor(page);
    await page.getByRole('button', { name: 'Eliminar', exact: true }).first().click();

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await expect(page.getByText('Añade algo a la línea de tiempo antes de exportar.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Exportar vídeo' })).toBeDisabled();
  });

  test('exporta a MP4, que es el formato por defecto', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVideoEditor(page);

    await page.getByRole('button', { name: 'Exportar', exact: true }).click();
    await page.getByLabel('Resolución').selectOption('480');
    await page.getByLabel('Fotogramas por segundo').selectOption('24');

    /*
     * Este test faltaba, y su ausencia costó cara: la suite solo exportaba
     * WebM, «para no depender de un Chromium sin H.264». Pero el que no haya
     * descodificador no impide comprobar que ffmpeg produce el archivo — y no
     * lo producía. Sin `-threads`, libx264 se cae contra el núcleo multihilo
     * (PLAN §3.8), así que pulsar Exportar con los ajustes de fábrica no
     * terminaba nunca.
     *
     * De ahí el tiempo de espera corto y deliberado: si esto vuelve a colgarse,
     * el test tiene que fallar, no esperar callado hasta el límite global.
     */
    const download = page.waitForEvent('download', { timeout: 90_000 });
    await page.getByRole('button', { name: 'Exportar vídeo' }).click();
    const file = await download;

    expect(file.suggestedFilename()).toBe('clip-forja.mp4');
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(await file.path());
    expect(bytes.length).toBeGreaterThan(1000);
    // La caja `ftyp` de ISO-BMFF: prueba de que es un MP4 y no un archivo a medias.
    expect(bytes.subarray(4, 8).toString('latin1')).toBe('ftyp');
    expectNoErrors(errors);
  });
});
