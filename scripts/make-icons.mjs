/**
 * Rasteriza los iconos de la aplicación instalable a partir de `public/icon.svg`.
 *
 * Se usa Chromium (ya disponible por Playwright) porque el entorno no tiene
 * ImageMagick ni cairosvg, y porque rasterizar con el mismo motor que luego
 * dibuja la interfaz evita sorpresas de antialiasing.
 *
 *   node scripts/make-icons.mjs
 *
 * Los PNG resultantes se versionan en el repositorio: no hace falta ejecutar
 * esto en cada compilación.
 */
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const OUT = path.resolve(import.meta.dirname, '../public');
const BG = '#14181d';
const MARK = `
  <path d="M10 22 L16 7 L22 22" fill="none" stroke="#ff7a2f" stroke-width="3"
        stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M12.5 17 H19.5" stroke="#ff7a2f" stroke-width="3" stroke-linecap="round"/>`;

/** El icono normal: esquinas redondeadas propias, como se ve en una pestaña. */
const rounded = `<rect width="32" height="32" rx="8" fill="${BG}"/>${MARK}`;

/**
 * Android recorta los iconos «maskable» con la forma que elija el lanzador, y
 * solo garantiza el 80 % central. El fondo va a sangre y la marca se encoge
 * para caber en esa zona segura.
 */
const maskable = `<rect width="32" height="32" fill="${BG}"/>
  <g transform="translate(16,16) scale(0.66) translate(-16,-16)">${MARK}</g>`;

/** iOS aplica su propio redondeo y no respeta la transparencia. */
const apple = `<rect width="32" height="32" fill="${BG}"/>
  <g transform="translate(16,16) scale(0.78) translate(-16,-16)">${MARK}</g>`;

const ICONS = [
  { file: 'icon-192.png', size: 192, body: rounded },
  { file: 'icon-512.png', size: 512, body: rounded },
  { file: 'icon-maskable-512.png', size: 512, body: maskable },
  { file: 'apple-touch-icon.png', size: 180, body: apple },
];

const browser = await chromium.launch({
  ...(process.env['FORJA_CHROME'] ? { executablePath: process.env['FORJA_CHROME'] } : {}),
});

for (const { file, size, body } of ICONS) {
  const page = await browser.newPage({
    viewport: { width: size, height: size },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<!doctype html><html><head><style>
       html,body{margin:0;padding:0;background:transparent}
       svg{display:block;width:${size}px;height:${size}px}
     </style></head><body>
     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${body}</svg>
     </body></html>`,
  );
  const png = await page.screenshot({ omitBackground: true, type: 'png' });
  await writeFile(path.join(OUT, file), png);
  await page.close();
  console.log(`${file} · ${size}×${size} · ${(png.length / 1024).toFixed(1)} kB`);
}

await browser.close();
