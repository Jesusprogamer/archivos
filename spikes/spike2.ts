/** Spike round 2: multithreaded core, drawtext with a real font file. */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const result: Record<string, unknown> = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

async function main() {
  log('crossOriginIsolated', self.crossOriginIsolated);

  const lines: string[] = [];
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => lines.push(message));

  const base = `${location.origin}/ffmpeg/core-mt`;
  const t0 = performance.now();
  try {
    await ffmpeg.load({
      coreURL: `${base}/ffmpeg-core.js`,
      wasmURL: `${base}/ffmpeg-core.wasm`,
      workerURL: `${base}/ffmpeg-core.worker.js`,
    });
    log('mtLoadMs', Math.round(performance.now() - t0));
  } catch (error) {
    log('mtLoadError', String(error));
    log('done', true);
    return;
  }

  // Multithreaded transcode of the sample clip, with -threads honoured.
  const clip = new Uint8Array(await (await fetch('/fixtures/clip.mp4')).arrayBuffer());
  await ffmpeg.writeFile('in.mp4', clip);
  lines.length = 0;
  let t1 = performance.now();
  const code = await ffmpeg.exec([
    '-i', 'in.mp4', '-threads', '4', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-crf', '28', '-c:a', 'aac', 'out.mp4',
  ]);
  const mp4 = (await ffmpeg.readFile('out.mp4')) as Uint8Array;
  log('mtTranscode', { exitCode: code, bytes: mp4.length, ms: Math.round(performance.now() - t1) });
  log('threadLog', lines.filter((l) => /thread/i.test(l)).slice(0, 4));

  // drawtext with an explicit font file written into the virtual FS.
  const font = new Uint8Array(await (await fetch('/fixtures/font.ttf')).arrayBuffer());
  await ffmpeg.writeFile('font.ttf', font);
  lines.length = 0;
  try {
    const dt = await ffmpeg.exec([
      '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=1',
      '-vf', "drawtext=fontfile=font.ttf:text='Forja':fontcolor=white:fontsize=24:x=10:y=10",
      '-frames:v', '1', 'dt.png',
    ]);
    const png = (await ffmpeg.readFile('dt.png')) as Uint8Array;
    log('drawtextWithFont', { exitCode: dt, bytes: png.length });
  } catch (error) {
    log('drawtextWithFont', { error: String(error), log: lines.slice(-5) });
  }

  // Image pipeline check: PNG -> AVIF / WebP through ffmpeg.
  lines.length = 0;
  const png = new Uint8Array(await (await fetch('/fixtures/photo.png')).arrayBuffer());
  await ffmpeg.writeFile('p.png', png);
  for (const [name, args] of [
    ['webp', ['-i', 'p.png', '-c:v', 'libwebp', '-quality', '80', 'p.webp']],
    ['avif', ['-i', 'p.png', 'p.avif']],
    ['bmp', ['-i', 'p.png', 'p.bmp']],
  ] as const) {
    lines.length = 0;
    try {
      const c = await ffmpeg.exec([...args]);
      const data = (await ffmpeg.readFile(args[args.length - 1] as string)) as Uint8Array;
      log(`image_${name}`, { exitCode: c, bytes: data.length });
    } catch (error) {
      log(`image_${name}`, { error: String(error), log: lines.slice(-3) });
    }
  }

  // Video -> GIF with a generated palette, the quality-critical two-pass route.
  lines.length = 0;
  try {
    t1 = performance.now();
    const c = await ffmpeg.exec([
      '-i', 'in.mp4', '-vf', 'fps=10,scale=240:-1:flags=lanczos,palettegen', '-y', 'pal.png',
    ]);
    const c2 = await ffmpeg.exec([
      '-i', 'in.mp4', '-i', 'pal.png',
      '-filter_complex', 'fps=10,scale=240:-1:flags=lanczos[x];[x][1:v]paletteuse',
      '-y', 'out.gif',
    ]);
    const gif = (await ffmpeg.readFile('out.gif')) as Uint8Array;
    log('gif', { pass1: c, pass2: c2, bytes: gif.length, ms: Math.round(performance.now() - t1) });
  } catch (error) {
    log('gif', { error: String(error), log: lines.slice(-4) });
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
