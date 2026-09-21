import { expect, test, type Page } from '@playwright/test';
import { fixture, openFiles, watchForErrors, expectNoErrors } from './helpers';

/**
 * Tres fallos que compartían una misma causa: cosas que se mueven en pantalla
 * sin que nadie estuviera mirando si se movían de verdad.
 */

/** Posición en píxeles del marcador del cabezal. */
async function playheadX(page: Page): Promise<number> {
  return page.evaluate(() => {
    const marker = document.querySelector<HTMLElement>('[class*="playhead"]');
    return marker ? Math.round(parseFloat(getComputedStyle(marker).left)) : -1;
  });
}

test.describe('El cabezal durante la reproducción', () => {
  test('el marcador de la línea de tiempo avanza con el vídeo', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['clip.webm']);
    await expect(page.getByRole('slider', { name: 'Línea de tiempo' })).toBeVisible({
      timeout: 30_000,
    });

    expect(await playheadX(page)).toBe(0);
    await page.getByRole('button', { name: 'Reproducir', exact: true }).first().click();

    await page.waitForTimeout(500);
    const first = await playheadX(page);
    await page.waitForTimeout(800);
    const second = await playheadX(page);

    // El contador de tiempo avanzaba y el marcador se quedaba en cero, porque
    // dibujaba el cabezal del editor y el reloj lo lleva el reproductor.
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThan(first);
    expectNoErrors(errors);
  });

  test('al pausar, el editor se queda donde llegó la reproducción', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['clip.webm']);
    const slider = page.getByRole('slider', { name: 'Línea de tiempo' });
    await expect(slider).toBeVisible({ timeout: 30_000 });
    await expect(slider).toHaveAttribute('aria-valuenow', '0');

    await page.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await page.waitForTimeout(1100);
    await page.getByRole('button', { name: 'Pausa', exact: true }).first().click();

    // Si no se sincroniza, pausar y dividir corta donde se pulsó play.
    await expect(slider).not.toHaveAttribute('aria-valuenow', '0');
  });

  test('la onda de audio sigue al cabezal cuando está ampliada', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);
    await expect(page.getByRole('button', { name: 'Reproducir', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Con zoom, la ventana visible es más corta que el audio, así que el
    // cabezal se sale a los pocos segundos si la vista no lo acompaña.
    for (let i = 0; i < 4; i += 1) await page.getByRole('button', { name: 'Acercar' }).click();

    const region = page.locator('canvas').first();
    const before = await region.screenshot();
    await page.getByRole('button', { name: 'Reproducir', exact: true }).first().click();
    await page.waitForTimeout(2200);
    const after = await region.screenshot();

    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('El panel del visualizador', () => {
  test('activar el logo no se lleva el área de trabajo fuera de la pantalla', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);
    await page.getByRole('button', { name: 'Visualizador', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Barras', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    page.on('filechooser', (chooser) => void chooser.setFiles(fixture('photo.png')));

    const canvasTop = async () =>
      page.evaluate(() =>
        Math.round(document.querySelector('canvas')!.getBoundingClientRect().top),
      );
    const before = await canvasTop();

    // El interruptor abre el selector de archivos, y al enfocarlo el navegador
    // lo desplazaba a la vista. Como vive al final de un panel largo dentro de
    // un contenedor con overflow oculto, el área de trabajo se iba de la
    // pantalla y no había forma de traerla de vuelta salvo recargar.
    await page.locator('label').filter({ hasText: 'Mostrar logo' }).first().click();
    await page.waitForTimeout(1500);

    expect(await canvasTop()).toBe(before);
    expect(await page.evaluate(() => document.querySelector('main')!.scrollTop)).toBe(0);
    expectNoErrors(errors);
  });

  test('ningún contenedor del estudio puede quedarse desplazado', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);
    await page.getByRole('button', { name: 'Visualizador', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Barras', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // El visualizador es el espacio con el panel más alto, así que su contenido
    // desborda de verdad: es donde un `overflow: hidden` sí se dejaría
    // desplazar. Con `overflow: clip` no hay contenedor que desplazar, así que
    // ni siquiera por código se puede dejar el estudio fuera de sitio.
    const stuck = await page.evaluate(() => {
      const main = document.querySelector<HTMLElement>('main')!;
      main.scrollTop = 500;
      main.scrollLeft = 500;
      return { top: main.scrollTop, left: main.scrollLeft };
    });
    expect(stuck).toEqual({ top: 0, left: 0 });
  });
});
