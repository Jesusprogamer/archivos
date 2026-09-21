import { expect, test, type Page } from '@playwright/test';
import { expectNoErrors, watchForErrors } from './helpers';

/** Espera a que el service worker haya instalado y tomado el control. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      await navigator.serviceWorker.ready;
      return navigator.serviceWorker.controller !== null;
    },
    undefined,
    { timeout: 30_000 },
  );
}

test.describe('Aplicación instalable', () => {
  test('el manifiesto declara lo que hace falta para instalar', async ({ page, request }) => {
    await page.goto('/');

    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(href).toBeTruthy();

    const response = await request.get(new URL(href!, page.url()).toString());
    expect(response.status()).toBe(200);

    const manifest = (await response.json()) as {
      name: string;
      short_name: string;
      start_url: string;
      display: string;
      icons: { src: string; sizes: string; purpose: string }[];
    };

    expect(manifest.name).toContain('Forja');
    expect(manifest.short_name).toBe('Forja');
    expect(manifest.display).toBe('standalone');

    // Chrome exige un icono de 192 y otro de 512 para ofrecer la instalación,
    // y Android necesita uno «maskable» o recorta el logo a lo bruto.
    const sizes = manifest.icons.map((icon) => icon.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });

  test('los iconos existen y miden lo que dicen medir', async ({ page, request }) => {
    await page.goto('/');
    const base = new URL('.', page.url()).toString();

    for (const [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable-512.png', 512],
      ['apple-touch-icon.png', 180],
    ] as const) {
      const response = await request.get(new URL(file, base).toString());
      expect(response.status(), file).toBe(200);
      const body = await response.body();
      // Cabecera PNG: firma, y luego ancho y alto en IHDR.
      expect(body.subarray(1, 4).toString('latin1'), file).toBe('PNG');
      expect(body.readUInt32BE(16), file).toBe(size);
      expect(body.readUInt32BE(20), file).toBe(size);
    }
  });

  test('el service worker toma el control sin ensuciar la consola', async ({ page }) => {
    const { errors } = watchForErrors(page);
    await page.goto('/');
    await waitForServiceWorker(page);
    expectNoErrors(errors);
  });

  test('sin conexión la aplicación sigue abriendo', async ({ page, context }) => {
    await page.goto('/');
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await page.reload();

    // La prueba de fuego: la interfaz completa, sin red.
    await expect(page.getByRole('heading', { level: 1 })).toContainText('estudio');
    await expect(page.getByRole('button', { name: /Suelta un archivo/ })).toBeVisible();
    await context.setOffline(false);
  });

  test('no se precargan los 63 MB de ffmpeg ni los 14 de ONNX', async ({ page }) => {
    await page.goto('/');
    await waitForServiceWorker(page);

    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const name of names.filter((n) => n.includes('shell'))) {
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((request) => request.url));
      }
      return urls;
    });

    expect(cached.length).toBeGreaterThan(10);
    expect(cached.filter((url) => url.includes('/ffmpeg/'))).toEqual([]);
    expect(cached.filter((url) => url.endsWith('.wasm'))).toEqual([]);
    // Los archivos de prueba de este propio suite tampoco pintan nada ahí.
    expect(cached.filter((url) => url.includes('/fixtures/'))).toEqual([]);
  });

  test('el botón de instalar no aparece si el navegador no puede instalar', async ({ page }) => {
    await page.goto('/');
    // Chromium sin perfil persistente no dispara `beforeinstallprompt`, así que
    // aquí se comprueba lo que el encargo exige: nada de botones decorativos.
    await expect(page.getByRole('button', { name: 'Instalar aplicación' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Ajustes' }).click();
    // Pero el estado sí se explica, en vez de callarse.
    await expect(page.getByText(/no instala aplicaciones web|Lista para instalar/)).toBeVisible();
  });
});
