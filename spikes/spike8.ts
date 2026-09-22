/**
 * Spike 8: ¿por qué no termina nunca una exportación a MP4?
 *
 * Medido en la aplicación: WebM sale en 4–6 s y MP4 no acaba en 180 s, a
 * cualquier resolución. La sospecha es libx264 contra el núcleo multihilo, que
 * es el que se usa cuando la página está aislada, es decir casi siempre.
 *
 * Cada prueba usa una instancia nueva y la mata al agotarse el tiempo: una
 * instancia colgada no sirve para la siguiente medición.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const result: Record<string, unknown> = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

async function run(
  name: string,
  variant: 'core' | 'core-mt',
  args: string[],
  timeoutMs = 60_000,
): Promise<void> {
  const base = `${location.origin}/ffmpeg/${variant}`;
  const lines: string[] = [];
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => lines.push(message ?? ''));
  await ffmpeg.load({
    coreURL: `${base}/ffmpeg-core.js`,
    wasmURL: `${base}/ffmpeg-core.wasm`,
    ...(variant === 'core-mt' ? { workerURL: `${base}/ffmpeg-core.worker.js` } : {}),
  });

  const canvas = new OffscreenCanvas(854, 480);
  const context = canvas.getContext('2d', { alpha: false })!;
  for (let i = 0; i < 48; i += 1) {
    context.fillStyle = `hsl(${(i * 9) % 360} 80% 50%)`;
    context.fillRect(0, 0, 854, 480);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    await ffmpeg.writeFile(
      `f${String(i).padStart(5, '0')}.jpg`,
      new Uint8Array(await blob.arrayBuffer()),
    );
  }

  const started = performance.now();
  let timer = 0;
  const guard = new Promise<'timeout'>((resolve) => {
    timer = self.setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const race = await Promise.race([ffmpeg.exec(args).then(() => 'ok' as const), guard]);
    const secs = +((performance.now() - started) / 1000).toFixed(1);
    if (race === 'timeout') {
      log(name, { colgado: true, tras: secs, ultimas: lines.slice(-3) });
    } else {
      const data = (await ffmpeg.readFile(args[args.length - 1]!)) as Uint8Array<ArrayBuffer>;
      log(name, { segundos: secs, bytes: data.length });
    }
  } catch (error) {
    log(name, { error: String(error), ultimas: lines.slice(-3) });
  } finally {
    self.clearTimeout(timer);
    ffmpeg.terminate();
  }
}

const X264 = (extra: string[] = []) => [
  '-framerate',
  '24',
  '-i',
  'f%05d.jpg',
  '-c:v',
  'libx264',
  '-preset',
  'veryfast',
  '-crf',
  '23',
  '-pix_fmt',
  'yuv420p',
  ...extra,
  '-an',
  '-y',
  'a.mp4',
];
const VP8 = [
  '-framerate',
  '24',
  '-i',
  'f%05d.jpg',
  '-c:v',
  'libvpx',
  '-crf',
  '20',
  '-b:v',
  '3M',
  '-deadline',
  'realtime',
  '-cpu-used',
  '5',
  '-an',
  '-y',
  'c.webm',
];

// ¿Algún grado de paralelismo sobrevive? De eso depende cuánto se puede ganar.
for (const n of ['1', '2', '4']) {
  await run(`x264_threads_${n}`, 'core-mt', X264(['-threads', n]));
}
await run('x265_sin_threads', 'core-mt', [
  '-framerate',
  '24',
  '-i',
  'f%05d.jpg',
  '-c:v',
  'libx265',
  '-preset',
  'veryfast',
  '-crf',
  '28',
  '-pix_fmt',
  'yuv420p',
  '-tag:v',
  'hvc1',
  '-an',
  '-y',
  'd.mp4',
]);
await run('x265_threads_1', 'core-mt', [
  '-framerate',
  '24',
  '-i',
  'f%05d.jpg',
  '-c:v',
  'libx265',
  '-preset',
  'veryfast',
  '-crf',
  '28',
  '-pix_fmt',
  'yuv420p',
  '-tag:v',
  'hvc1',
  '-threads',
  '1',
  '-an',
  '-y',
  'd.mp4',
]);
await run('vp8_sin_threads', 'core-mt', VP8);
await run('vp8_threads_4', 'core-mt', [
  '-framerate',
  '24',
  '-i',
  'f%05d.jpg',
  '-c:v',
  'libvpx',
  '-crf',
  '20',
  '-b:v',
  '3M',
  '-deadline',
  'realtime',
  '-cpu-used',
  '5',
  '-threads',
  '4',
  '-an',
  '-y',
  'c.webm',
]);

log('status', 'done');
