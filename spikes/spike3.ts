/**
 * Spike 3: which WebM encoder settings actually survive this ffmpeg.wasm build.
 *
 * The encoder appearing in `-encoders` only means it was compiled in. Running
 * it is a separate question, and the answer here is not the one the
 * documentation implies.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const result: Record<string, unknown> = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

async function main() {
  const lines: string[] = [];
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => lines.push(message));
  const base = `${location.origin}/ffmpeg/core`;
  await ffmpeg.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
  log('loaded', true);

  // `writeFile` transfers the buffer, so the source is re-fetched each time
  // rather than reusing a view that has been detached.
  const fetchClip = async () =>
    new Uint8Array(await (await fetch('/fixtures/clip.mp4')).arrayBuffer());
  let current = ffmpeg;
  await current.writeFile('in.mp4', await fetchClip());

  const attempts: Array<[string, string[]]> = [
    ['vp9-plain', ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0']],
    ['vp9-rowmt', ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-row-mt', '1']],
    ['vp9-realtime', ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '5']],
    ['vp9-good', ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-deadline', 'good', '-cpu-used', '2']],
    ['vp9-threads1', ['-c:v', 'libvpx-vp9', '-crf', '33', '-b:v', '0', '-threads', '1']],
    ['vp9-bitrate', ['-c:v', 'libvpx-vp9', '-b:v', '600k']],
    ['vp8-plain', ['-c:v', 'libvpx', '-crf', '30', '-b:v', '0']],
    ['vp8-bitrate', ['-c:v', 'libvpx', '-b:v', '600k']],
    ['vp8-deadline', ['-c:v', 'libvpx', '-b:v', '600k', '-deadline', 'realtime', '-cpu-used', '5']],
  ];

  for (const [name, args] of attempts) {
    lines.length = 0;
    const started = performance.now();
    try {
      const code = await current.exec(['-i', 'in.mp4', ...args, '-an', '-y', `${name}.webm`]);
      const data = (await current.readFile(`${name}.webm`)) as Uint8Array;
      log(name, { code, bytes: data.length, ms: Math.round(performance.now() - started) });
      await current.deleteFile(`${name}.webm`);
    } catch (error) {
      log(name, { error: String(error), tail: lines.slice(-4) });
      // A trap poisons the whole instance, so the next attempt needs a new one.
      current.terminate();
      current = new FFmpeg();
      current.on('log', ({ message }) => lines.push(message));
      await current.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
      await current.writeFile('in.mp4', await fetchClip());
    }
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
