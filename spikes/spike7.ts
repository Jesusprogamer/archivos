/**
 * Spike 7: ¿sabe este build codificar vídeo con canal alfa?
 *
 * Antes de ofrecer «fondo transparente» en el visualizador hay que comprobarlo,
 * no suponerlo: PLAN §3.6 existe porque tres codificadores que figuraban en la
 * lista resultaron estar rotos al ejecutarlos.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const result: Record<string, unknown> = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

const base = `${location.origin}/ffmpeg/core`;
let lines: string[] = [];

const ffmpeg = new FFmpeg();
ffmpeg.on('log', ({ message }) => lines.push(message));
await ffmpeg.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });

// Qué formatos de píxel admite libvpx según él mismo.
lines = [];
await ffmpeg.exec(['-h', 'encoder=libvpx']).catch(() => {});
const pix = lines.find((l) => l.includes('pixel formats')) ?? '(no lo dice)';
log('libvpx_pix_fmts', pix.trim());

// Unos PNG con transparencia de verdad: mitad opaca, mitad transparente.
const canvas = new OffscreenCanvas(160, 120);
const context = canvas.getContext('2d', { alpha: true })!;
for (let i = 0; i < 20; i += 1) {
  context.clearRect(0, 0, 160, 120);
  context.fillStyle = '#ff7a2f';
  context.fillRect(0, 0, 80, 120);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  await ffmpeg.writeFile(
    `a${String(i).padStart(5, '0')}.png`,
    new Uint8Array(await blob.arrayBuffer()),
  );
}

for (const [name, args] of [
  ['vp8_yuva420p', ['-c:v', 'libvpx', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-b:v', '1M']],
  ['vp8_yuv420p', ['-c:v', 'libvpx', '-pix_fmt', 'yuv420p', '-b:v', '1M']],
] as const) {
  lines = [];
  try {
    await ffmpeg.exec(['-framerate', '10', '-i', 'a%05d.png', ...args, '-y', `${name}.webm`]);
    const data = (await ffmpeg.readFile(`${name}.webm`)) as Uint8Array<ArrayBuffer>;
    log(name, { ok: true, bytes: data.length });
  } catch (error) {
    log(name, { ok: false, error: String(error), tail: lines.slice(-6) });
  }
}

// ¿Sobrevive el alfa a la vuelta? Se descodifica y se mira un píxel del lado
// que debía quedar transparente.
try {
  lines = [];
  await ffmpeg.exec(['-i', 'vp8_yuva420p.webm', '-frames:v', '1', '-y', 'back%05d.png']);
  const png = (await ffmpeg.readFile('back00001.png')) as Uint8Array<ArrayBuffer>;
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const check = new OffscreenCanvas(bitmap.width, bitmap.height);
  const cc = check.getContext('2d', { alpha: true })!;
  cc.drawImage(bitmap, 0, 0);
  const opaque = cc.getImageData(10, 60, 1, 1).data;
  const clear = cc.getImageData(bitmap.width - 10, 60, 1, 1).data;
  log('roundtrip', {
    lado_opaco_alfa: opaque[3],
    lado_transparente_alfa: clear[3],
    conserva_alfa: clear[3] === 0 && opaque[3] === 255,
  });
} catch (error) {
  log('roundtrip', { ok: false, error: String(error), tail: lines.slice(-6) });
}

// Lo que de verdad importa: ¿lo ve transparente un navegador? Es el consumidor
// real del archivo, no ffmpeg.
try {
  const data = (await ffmpeg.readFile('vp8_yuva420p.webm')) as Uint8Array<ArrayBuffer>;
  const url = URL.createObjectURL(new Blob([data], { type: 'video/webm' }));
  const video = document.createElement('video');
  video.muted = true;
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('el navegador no lo descodifica'));
  });
  video.currentTime = 0.2;
  await new Promise<void>((resolve) => {
    video.onseeked = () => resolve();
  });

  const probe = new OffscreenCanvas(video.videoWidth, video.videoHeight);
  const pc = probe.getContext('2d', { alpha: true, willReadFrequently: true })!;
  pc.clearRect(0, 0, probe.width, probe.height);
  pc.drawImage(video, 0, 0);
  const opaque = pc.getImageData(10, 60, 1, 1).data;
  const clear = pc.getImageData(probe.width - 10, 60, 1, 1).data;
  log('en_el_navegador', {
    tamano: [video.videoWidth, video.videoHeight],
    lado_opaco_alfa: opaque[3],
    lado_transparente_alfa: clear[3],
    transparente_de_verdad: (clear[3] ?? 255) < 16 && (opaque[3] ?? 0) > 240,
  });
  URL.revokeObjectURL(url);
} catch (error) {
  log('en_el_navegador', { ok: false, error: String(error) });
}

log('status', 'done');
