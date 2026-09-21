/** Spike 6: can this build encode Opus at all, and if so, how? */
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
  await ffmpeg.exec([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100',
    '-ac', '2', '-c:a', 'pcm_s16le', '-y', 'in.wav',
  ]);
  await ffmpeg.exec([
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=48000',
    '-ac', '2', '-c:a', 'pcm_s16le', '-y', 'in48.wav',
  ]);
  return ffmpeg;
}

async function main() {
  let ffmpeg = await fresh();

  const attempts: Array<[string, string[]]> = [
    ['opus-44k-default', ['-i', 'in.wav', '-c:a', 'libopus', '-b:a', '128k', '-y', 'a.opus']],
    ['opus-48k-default', ['-i', 'in48.wav', '-c:a', 'libopus', '-b:a', '128k', '-y', 'b.opus']],
    ['opus-44k-forced48', ['-i', 'in.wav', '-c:a', 'libopus', '-ar', '48000', '-b:a', '128k', '-y', 'c.opus']],
    ['opus-into-ogg', ['-i', 'in48.wav', '-c:a', 'libopus', '-b:a', '128k', '-f', 'ogg', '-y', 'd.ogg']],
    ['opus-vbr-off', ['-i', 'in48.wav', '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'off', '-y', 'e.opus']],
    ['opus-mono', ['-i', 'in48.wav', '-c:a', 'libopus', '-ac', '1', '-b:a', '64k', '-y', 'f.opus']],
    ['vorbis-control', ['-i', 'in.wav', '-c:a', 'libvorbis', '-q:a', '5', '-y', 'g.ogg']],
  ];

  for (const [name, args] of attempts) {
    lines = [];
    try {
      const code = await ffmpeg.exec(args);
      const data = (await ffmpeg.readFile(args[args.length - 1]!)) as Uint8Array;
      log(name, { code, bytes: data.length });
    } catch (error) {
      log(name, { error: String(error), tail: lines.slice(-3) });
      ffmpeg.terminate();
      ffmpeg = await fresh();
    }
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
