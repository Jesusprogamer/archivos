import { expect, test } from '@playwright/test';
import { openFiles } from './helpers';

/*
 * Pantalla de móvil descrita a mano en vez de con `devices['iPhone 13']`: el
 * descriptor completo incluye `isMobile`, que obliga a Playwright a levantar
 * un navegador aparte y no arranca en esta imagen. Lo que se comprueba aquí es
 * el diseño, y para eso basta el tamaño y el táctil.
 */
test.use({ viewport: { width: 390, height: 664 }, hasTouch: true, locale: 'es-ES' });

/**
 * El encargo pedía que, como mínimo, el conversor y el editor de imagen
 * funcionaran en móvil. No funcionaban: la biblioteca se abría por defecto y
 * tapaba el editor, y no había ninguna prueba que mirase una pantalla estrecha.
 */
test.describe('En móvil', () => {
  test('el editor de imagen se ve, en vez de quedar tapado por la biblioteca', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const canvas = await page.locator('canvas').first().boundingBox();
    expect(canvas).not.toBeNull();
    // Antes el lienzo quedaba debajo del cajón de la biblioteca, que ocupaba
    // los primeros 300 px de una pantalla de 390.
    expect(canvas!.width).toBeGreaterThan(200);

    // El cajón existe en el DOM pero empieza cerrado, así que nada lo tapa.
    await expect(page.getByRole('complementary', { name: 'Biblioteca' })).toBeHidden();

    // Y el lienzo se puede tocar de verdad: nada invisible por encima.
    const onTop = await page.evaluate(() => {
      const box = document.querySelector('canvas')!.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit?.tagName ?? 'nada';
    });
    expect(onTop).toBe('CANVAS');
  });

  test('la biblioteca se abre como cajón sin tapar la barra superior', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: /biblioteca/i }).first().click();
    const drawer = page.getByRole('complementary', { name: 'Biblioteca' });
    await expect(drawer).toBeVisible();

    const box = (await drawer.boundingBox())!;
    const bar = (await page.locator('header').first().boundingBox())!;
    // Se posicionaba contra el viewport y se subía por encima de las pestañas.
    expect(box.y).toBeGreaterThanOrEqual(bar.y + bar.height - 1);
    // Y dejaba ver que hay algo detrás, que es lo que invita a cerrarlo.
    expect(box.width).toBeLessThan(340);
  });

  test('nada desborda a lo ancho', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    const { doc, win } = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(doc).toBeLessThanOrEqual(win);
  });

  test('el conversor sigue siendo usable, como exigía el encargo', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    await expect(page.getByRole('button', { name: /^JPEG/ })).toBeVisible({ timeout: 30_000 });
  });
});
