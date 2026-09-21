/** Spike 5: the exporter's exact pipeline — JPEG frames, VP8, float WAV, mux. */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const result: Record<string, unknown> = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

const base = `${location.origin}/ffmpeg/core`;
let lines: string[] = [];

async function fresh(): Promise<FFmpeg> {
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => lines.push(message));
  await ffmpeg.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
  return ffmpeg;
}

/** A WAV in either sample format, to see which one ffmpeg will accept. */
function makeWav(seconds: number, float: boolean, rate = 48000): Uint8Array {
  const bytesPerSample = float ? 4 : 2;
  const blockAlign = 2 * bytesPerSample;
  const frames = Math.round(seconds * rate);
  const buffer = new ArrayBuffer(44 + frames * blockAlign);
  const view = new DataView(buffer);
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + frames * blockAlign, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? 3 : 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  ascii(36, 'data');
  view.setUint32(40, frames * blockAlign, true);
  for (let i = 0; i < frames; i += 1) {
    const value = Math.sin((i / rate) * 440 * 2 * Math.PI) * 0.4;
    for (let channel = 0; channel < 2; channel += 1) {
      const at = 44 + i * blockAlign + channel * bytesPerSample;
      if (float) view.setFloat32(at, value, true);
      else view.setInt16(at, Math.round(value * 32767), true);
    }
  }
  return new Uint8Array(buffer);
}

/** A JPEG frame, the way the exporter makes them. */
async function jpegFrame(index: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(640, 480);
  const context = canvas.getContext('2d')!;
  context.fillStyle = `hsl(${index * 7}, 70%, 50%)`;
  context.fillRect(0, 0, 640, 480);
  context.fillStyle = '#fff';
  context.font = '48px sans-serif';
  context.fillText(String(index), 40, 100);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  return new Uint8Array(await blob.arrayBuffer());
}

async function main() {
  const ffmpeg = await fresh();
  const FRAMES = 48;

  for (let i = 0; i < FRAMES; i += 1) {
    await ffmpeg.writeFile(`f${String(i).padStart(5, '0')}.jpg`, await jpegFrame(i));
  }
  log('framesWritten', FRAMES);

  lines = [];
  try {
    const code = await ffmpeg.exec([
      '-framerate', '24', '-i', 'f%05d.jpg',
      '-c:v', 'libvpx', '-crf', '20', '-b:v', '3M',
      '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_0.webm',
    ]);
    const seg = (await ffmpeg.readFile('seg_0.webm')) as Uint8Array;
    log('segment', { code, bytes: seg.length });
  } catch (error) {
    log('segment', { error: String(error), tail: lines.slice(-6) });
    log('done', true);
    return;
  }

  await ffmpeg.writeFile('float.wav', makeWav(2, true));
  await ffmpeg.writeFile('int16.wav', makeWav(2, false));
  await ffmpeg.writeFile('segments.txt', new TextEncoder().encode("file 'seg_0.webm'\n"));

  const attempts: Array<[string, string[]]> = [
    ['int16-concat-opus', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'int16.wav', '-c:a', 'libopus', '-b:a', '192k', '-shortest', '-c:v', 'copy', '-y', 'a.webm']],
    ['float-concat-opus', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'float.wav', '-c:a', 'libopus', '-b:a', '192k', '-shortest', '-c:v', 'copy', '-y', 'b.webm']],
    ['float-concat-opus-s16', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'float.wav', '-af', 'aformat=sample_fmts=s16', '-c:a', 'libopus', '-b:a', '192k', '-shortest', '-c:v', 'copy', '-y', 'c.webm']],
    ['int16-concat-vorbis', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'int16.wav', '-c:a', 'libvorbis', '-shortest', '-c:v', 'copy', '-y', 'd.webm']],
    ['int16-mp4-aac', ['-f', 'concat', '-safe', '0', '-i', 'mp4list.txt', '-i', 'int16.wav', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-c:v', 'copy', '-y', 'e.mp4']],
    ['float-mp4-aac', ['-f', 'concat', '-safe', '0', '-i', 'mp4list.txt', '-i', 'float.wav', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-c:v', 'copy', '-y', 'f.mp4']],
  ];

  let current = ffmpeg;
  const rebuild = async () => {
    current.terminate();
    current = await fresh();
    for (let i = 0; i < FRAMES; i += 1) {
      await current.writeFile(`f${String(i).padStart(5, '0')}.jpg`, await jpegFrame(i));
    }
    await current.exec(['-framerate', '24', '-i', 'f%05d.jpg', '-c:v', 'libvpx', '-crf', '20', '-b:v', '3M', '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_0.webm']);
    await current.exec(['-framerate', '24', '-i', 'f%05d.jpg', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_0.mp4']);
    await current.writeFile('float.wav', makeWav(2, true));
    await current.writeFile('int16.wav', makeWav(2, false));
    await current.writeFile('segments.txt', new TextEncoder().encode("file 'seg_0.webm'\n"));
    await current.writeFile('mp4list.txt', new TextEncoder().encode("file 'm_0.mp4'\n"));
  };

  await current.exec(['-framerate', '24', '-i', 'f%05d.jpg', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_0.mp4']);
  await current.writeFile('mp4list.txt', new TextEncoder().encode("file 'm_0.mp4'\n"));

  for (const [name, args] of attempts) {
    lines = [];
    try {
      const code = await current.exec(args);
      const data = (await current.readFile(args[args.length - 1]!)) as Uint8Array;
      log(name, { code, bytes: data.length });
    } catch (error) {
      log(name, { error: String(error), tail: lines.slice(-4) });
      await rebuild();
    }
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
