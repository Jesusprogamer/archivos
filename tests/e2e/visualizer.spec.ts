import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, openFiles, watchForErrors } from './helpers';

async function openVisualizer(page: Page) {
  await page.goto('/');
  await openFiles(page, ['tone.mp3']);
  await page.getByRole('button', { name: 'Visualizador', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Barras', exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** Reads the preview canvas and reports how much of it is not the background. */
async function paintedFraction(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label]');
    if (!canvas) return 0;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let bright = 0;
    for (let i = 0; i < data.length; i += 4) {
      // The default palette is warm orange; the background is near-black.
      if (data[i] > 120 && data[i] > data[i + 2] + 40) bright += 1;
    }
    return bright / (data.length / 4);
  });
}

test.describe('Audio visualiser', () => {
  test('offers six styles and draws the default one', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVisualizer(page);

    for (const style of [
      'Barras',
      'Barras en espejo',
      'Línea de onda',
      'Circular',
      'Espectro de área',
      'Partículas',
    ]) {
      await expect(page.getByRole('button', { name: style, exact: true })).toBeVisible();
    }
    expectNoErrors(errors);
  });

  test('every style paints something on the canvas', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVisualizer(page);
    // Move the playhead into the tone so there is signal to draw.
    await page.getByRole('slider', { name: 'Visualizador' }).fill('1.5');

    for (const style of [
      'Barras',
      'Barras en espejo',
      'Línea de onda',
      'Circular',
      'Espectro de área',
      'Partículas',
    ]) {
      await page.getByRole('button', { name: style, exact: true }).click();
      await page.waitForTimeout(150);
      expect(await paintedFraction(page), `${style} drew nothing`).toBeGreaterThan(0.0005);
    }
    expectNoErrors(errors);
  });

  test('the aspect ratio changes the canvas shape', async ({ page }) => {
    await openVisualizer(page);
    const shape = async () =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label]')!;
        return canvas.width / canvas.height;
      });

    expect(await shape()).toBeCloseTo(16 / 9, 1);
    await page.getByLabel('Proporción').selectOption('9:16');
    expect(await shape()).toBeCloseTo(9 / 16, 1);
    await page.getByLabel('Proporción').selectOption('1:1');
    expect(await shape()).toBeCloseTo(1, 2);
  });

  test('a preset round-trips the whole scene', async ({ page }) => {
    await openVisualizer(page);
    await page.getByRole('button', { name: 'Circular', exact: true }).click();
    await page.getByLabel('Proporción').selectOption('1:1');

    await page.getByLabel('Nombre del preset').fill('Mi preset');
    await page.getByRole('button', { name: 'Guardar como preset' }).click();
    await expect(page.getByText('Mi preset')).toBeVisible();

    // Change everything, then bring the preset back.
    await page.getByRole('button', { name: 'Barras', exact: true }).click();
    await page.getByLabel('Proporción').selectOption('16:9');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await expect(page.getByRole('button', { name: 'Circular', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel('Proporción')).toHaveValue('1:1');
  });

  test('exports a real video with the audio in it', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openVisualizer(page);

    await page.getByLabel('Resolución').selectOption('480');
    await page.getByLabel('Fotogramas por segundo').selectOption('24');
    await page.getByRole('button', { name: 'WebM (VP8)' }).click();

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Exportar vídeo' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('tone-visualizador.webm');

    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(await file.path());
    // EBML magic, and a size that means real frames rather than an empty shell.
    expect([...bytes.subarray(0, 4)]).toEqual([0x1a, 0x45, 0xdf, 0xa3]);
    expect(bytes.length).toBeGreaterThan(10_000);
    expectNoErrors(errors);
  });

  test('un fondo transparente sale transparente de verdad', async ({ page }) => {
    await openVisualizer(page);
    await page.getByRole('button', { name: 'Transparente', exact: true }).click();

    // MP4 está elegido por defecto y no tiene canal alfa: hay que decirlo, no
    // aplanar el fondo a negro en silencio.
    await expect(page.getByText(/MP4 no puede guardar transparencia/)).toBeVisible();
    await page.getByRole('button', { name: 'WebM (VP8)', exact: true }).click();
    await expect(page.getByText(/MP4 no puede guardar transparencia/)).toBeHidden();

    const download = page.waitForEvent('download', { timeout: 300_000 });
    await page.getByRole('button', { name: 'Exportar vídeo', exact: true }).click();
    const file = await download;

    const { readFile } = await import('node:fs/promises');
    const base64 = (await readFile(await file.path())).toString('base64');

    // Se comprueba en el navegador, que es el consumidor real: ffmpeg pierde el
    // alfa al volver a descodificar este WebM, el navegador no (PLAN §3.7).
    const corner = await page.evaluate(async (data) => {
      const video = document.createElement('video');
      video.muted = true;
      video.src = `data:video/webm;base64,${data}`;
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error('undecodable'));
      });
      video.currentTime = 0.3;
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
      });
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })!;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0);
      // Una esquina, donde el visual no dibuja nunca.
      return context.getImageData(4, 4, 1, 1).data[3];
    }, base64);

    expect(corner).toBe(0);
  });
});
