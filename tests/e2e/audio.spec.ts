import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, openFiles, watchForErrors } from './helpers';

/** Decodes a downloaded audio file in the browser and reports what it is. */
async function describeAudio(
  page: Page,
  filePath: string,
): Promise<{ duration: number; channels: number; peak: number }> {
  const { readFile } = await import('node:fs/promises');
  const base64 = (await readFile(filePath)).toString('base64');
  return page.evaluate(async (data) => {
    const response = await fetch(`data:application/octet-stream;base64,${data}`);
    const context = new AudioContext();
    try {
      const buffer = await context.decodeAudioData(await response.arrayBuffer());
      let peak = 0;
      const samples = buffer.getChannelData(0);
      for (const value of samples) peak = Math.max(peak, Math.abs(value));
      return { duration: buffer.duration, channels: buffer.numberOfChannels, peak };
    } finally {
      await context.close();
    }
  }, base64);
}

async function openAudioEditor(page: Page, file = 'tone.mp3') {
  await page.goto('/');
  await openFiles(page, [file]);
  await page.getByRole('button', { name: 'Audio', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Seleccionar todo' })).toBeVisible();
}

/** Drags across a fraction of the waveform to make a selection. */
async function selectRange(page: Page, fromFraction: number, toFraction: number) {
  const wave = page.locator('[role="application"]');
  const box = (await wave.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromFraction, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toFraction, y, { steps: 10 });
  await page.mouse.up();
}

async function exportAs(page: Page, format: string) {
  await page.getByLabel('Formato de salida').selectOption({ label: format });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).last().click();
  return download;
}

test.describe('Audio editor', () => {
  test('opens a file, draws its waveform and reports its length', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openAudioEditor(page);

    // The fixture is a three second tone.
    await expect(page.getByText('0:00.00 / 0:03.', { exact: false })).toBeVisible();
    await expect(page.locator('canvas')).toHaveCount(2);
    expectNoErrors(errors);
  });

  test('a drag selects a range and the panel reports it', async ({ page }) => {
    await openAudioEditor(page);
    await expect(page.getByText('Sin selección: se aplicará a todo')).toBeVisible();

    await selectRange(page, 0.25, 0.75);
    await expect(page.getByText('→', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cortar', exact: true })).toBeEnabled();
  });

  test('cutting a selection shortens the exported file', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openAudioEditor(page);

    const before = await exportAs(page, 'WAV');
    const original = await describeAudio(page, await before.path());
    expect(original.duration).toBeGreaterThan(2.9);

    await selectRange(page, 0.2, 0.8);
    await page.getByRole('button', { name: 'Cortar', exact: true }).click();

    const after = await exportAs(page, 'WAV');
    const cut = await describeAudio(page, await after.path());
    // Roughly 60 % of the tone is gone.
    expect(cut.duration).toBeLessThan(original.duration * 0.6);
    expect(cut.duration).toBeGreaterThan(0.5);
    expectNoErrors(errors);
  });

  test('undo restores what was cut', async ({ page }) => {
    await openAudioEditor(page);
    await selectRange(page, 0.2, 0.8);
    await page.getByRole('button', { name: 'Cortar', exact: true }).click();
    await page.getByRole('button', { name: 'Deshacer' }).click();

    const file = await exportAs(page, 'WAV');
    const restored = await describeAudio(page, await file.path());
    expect(restored.duration).toBeGreaterThan(2.9);
  });

  test('an effect previews before it is applied, and can be discarded', async ({ page }) => {
    await openAudioEditor(page);
    await page.getByRole('button', { name: 'Silenciar', exact: true }).click();
    await expect(page.getByText(/se oye tal cual quedará|Calculando/).first()).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
    const file = await exportAs(page, 'WAV');
    // Discarded, so the tone is still there.
    expect((await describeAudio(page, await file.path())).peak).toBeGreaterThan(0.1);
  });

  test('applying an effect changes the samples', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openAudioEditor(page);
    await page.getByRole('button', { name: 'Silenciar', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportAs(page, 'WAV');
    const silenced = await describeAudio(page, await file.path());
    expect(silenced.peak).toBeLessThan(0.001);
    expectNoErrors(errors);
  });

  test('normalise lifts a quiet passage to near full scale', async ({ page }) => {
    await openAudioEditor(page);
    // Pull the level right down first, then normalise it back up.
    await page.getByRole('button', { name: 'Volumen', exact: true }).click();
    await page.getByLabel('Ganancia', { exact: true }).first().fill('-30');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    await page.getByRole('button', { name: 'Normalizar', exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportAs(page, 'WAV');
    const normalised = await describeAudio(page, await file.path());
    expect(normalised.peak).toBeGreaterThan(0.8);
    expect(normalised.peak).toBeLessThanOrEqual(1);
  });

  test('a speed change that keeps the pitch shortens the file', async ({ page }) => {
    await openAudioEditor(page);
    await page.getByRole('button', { name: 'Velocidad', exact: true }).click();
    await page.getByLabel('Velocidad', { exact: true }).first().fill('2');
    await page.getByRole('button', { name: 'Aplicar' }).click();

    const file = await exportAs(page, 'WAV');
    const faster = await describeAudio(page, await file.path());
    expect(faster.duration).toBeGreaterThan(1.2);
    expect(faster.duration).toBeLessThan(1.8);
  });

  test('exports to MP3 through ffmpeg', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await openAudioEditor(page, 'tone.wav');

    const download = page.waitForEvent('download');
    await page.getByLabel('Formato de salida').selectOption({ label: 'MP3' });
    await page.getByRole('button', { name: 'Exportar', exact: true }).last().click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('tone.mp3');

    const result = await describeAudio(page, await file.path());
    expect(result.duration).toBeGreaterThan(2.8);
    expectNoErrors(errors);
  });

  test('playback starts and stops', async ({ page }) => {
    await openAudioEditor(page);
    await page.getByRole('button', { name: 'Reproducir' }).click();
    await expect(page.getByRole('button', { name: 'Pausa' })).toBeVisible();
    await page.getByRole('button', { name: 'Pausa' }).click();
    await expect(page.getByRole('button', { name: 'Reproducir' })).toBeVisible();
  });
});
