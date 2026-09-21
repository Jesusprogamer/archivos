import { chromium } from '@playwright/test';

const browser = await chromium.launch({ executablePath: process.env.FORJA_CHROME });
const page = await browser.newPage({ locale: 'es-ES', viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message.slice(0, 200)));

const timed = async (label, fn) => {
  const t0 = Date.now();
  await fn();
  console.log(`  ${label}: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
};

const memory = async () =>
  page.evaluate(() => {
    const m = performance.memory;
    return m ? Math.round(m.usedJSHeapSize / 1048576) : -1;
  });

console.log('--- PNG de 8,3 megapíxeles (3840x2160) ---');
await page.goto('http://localhost:4173/');
await timed('abrir en el editor de imagen', async () => {
  await page.locator('input[type="file"]').first().setInputFiles('/tmp/big/big.png');
  await page.getByRole('button', { name: 'Imagen', exact: true }).first().click();
  await page.getByRole('button', { name: 'Color', exact: true }).waitFor({ timeout: 120000 });
});
await timed('quitar el fondo por color', async () => {
  await page.getByLabel('Color (hex)').fill('#ff0000');
  await page.waitForTimeout(100);
  await page.getByRole('button', { name: 'Aplicar' }).click({ timeout: 120000 });
});
await timed('exportar a PNG', async () => {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar', exact: true }).click();
  await page.getByRole('button', { name: 'Descargar imagen' }).click();
  await dl;
});
console.log(`  memoria: ${await memory()} MB`);

console.log('--- MP3 de 10 minutos ---');
await page.goto('http://localhost:4173/');
await timed('abrir en el editor de audio', async () => {
  await page.locator('input[type="file"]').first().setInputFiles('/tmp/big/big.mp3');
  await page.getByRole('button', { name: 'Seleccionar todo' }).waitFor({ timeout: 180000 });
});
await timed('normalizar y aplicar', async () => {
  await page.getByRole('button', { name: 'Normalizar', exact: true }).click();
  await page.getByRole('button', { name: 'Aplicar' }).click({ timeout: 180000 });
});
await timed('dibujar la onda con zoom', async () => {
  await page.getByRole('button', { name: 'Acercar' }).click();
  await page.getByRole('button', { name: 'Acercar' }).click();
  await page.waitForTimeout(400);
});
console.log(`  memoria: ${await memory()} MB`);

console.log('--- WebM de 1080p, 2 minutos ---');
await page.goto('http://localhost:4173/');
await timed('abrir en el editor de vídeo', async () => {
  await page.locator('input[type="file"]').first().setInputFiles('/tmp/big/big.webm');
  await page.getByRole('slider', { name: 'Línea de tiempo' }).waitFor({ timeout: 180000 });
});
await timed('dividir en el cabezal', async () => {
  await page.locator('[role="button"][aria-pressed]').first().click();
  const box = await page.getByRole('slider', { name: 'Línea de tiempo' }).boundingBox();
  await page.mouse.click(box.x + 60, box.y + box.height / 2);
  await page.getByRole('button', { name: 'Dividir' }).click();
});
console.log(`  memoria: ${await memory()} MB`);

console.log(errors.length ? `ERRORES DE CONSOLA:\n  ${errors.join('\n  ')}` : 'errores de consola: ninguno');
await browser.close();
