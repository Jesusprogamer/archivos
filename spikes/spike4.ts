/** Spike 4: how to join encoded segments and add sound, in this wasm build. */
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

async function main() {
  let ffmpeg = await fresh();

  // Two one-second VP8 segments and a WAV, the shape the exporter produces.
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_0.webm']);
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_1.webm']);
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', '-y', 'mix.wav']);
  log('setup', { seg0: (await ffmpeg.readFile('seg_0.webm') as Uint8Array).length });

  const attempts: Array<[string, string[]]> = [
    ['mux-single', ['-i', 'seg_0.webm', '-i', 'mix.wav', '-c:v', 'copy', '-c:a', 'libopus', '-shortest', '-y', 'a.webm']],
    ['concat-copy', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-c', 'copy', '-y', 'b.webm']],
    ['concat-mux', ['-f', 'concat', '-safe', '0', '-i', 'segments.txt', '-i', 'mix.wav', '-c:v', 'copy', '-c:a', 'libopus', '-shortest', '-y', 'c.webm']],
    ['two-inputs-concat-filter', ['-i', 'seg_0.webm', '-i', 'seg_1.webm', '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '5', '-y', 'd.webm']],
    ['mp4-concat-copy', ['-f', 'concat', '-safe', '0', '-i', 'mp4list.txt', '-c', 'copy', '-y', 'e.mp4']],
  ];

  await ffmpeg.writeFile('segments.txt', new TextEncoder().encode("file 'seg_0.webm'\nfile 'seg_1.webm'\n"));
  // Also build two MP4 segments, to see whether the container is the problem.
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_0.mp4']);
  await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_1.mp4']);
  await ffmpeg.writeFile('mp4list.txt', new TextEncoder().encode("file 'm_0.mp4'\nfile 'm_1.mp4'\n"));

  for (const [name, args] of attempts) {
    lines = [];
    try {
      const code = await ffmpeg.exec(args);
      const outName = args[args.length - 1]!;
      const data = (await ffmpeg.readFile(outName)) as Uint8Array;
      log(name, { code, bytes: data.length });
    } catch (error) {
      log(name, { error: String(error), tail: lines.slice(-4) });
      ffmpeg.terminate();
      ffmpeg = await fresh();
      // Rebuild the inputs for the next attempt.
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_0.webm']);
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libvpx', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '5', '-an', '-y', 'seg_1.webm']);
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:a', 'pcm_s16le', '-y', 'mix.wav']);
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_0.mp4']);
      await ffmpeg.exec(['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=24:duration=1', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-an', '-y', 'm_1.mp4']);
      await ffmpeg.writeFile('segments.txt', new TextEncoder().encode("file 'seg_0.webm'\nfile 'seg_1.webm'\n"));
      await ffmpeg.writeFile('mp4list.txt', new TextEncoder().encode("file 'm_0.mp4'\nfile 'm_1.mp4'\n"));
    }
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
