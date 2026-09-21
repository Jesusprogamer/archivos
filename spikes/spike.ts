/**
 * Technical spike: answers the questions PLAN.md cannot answer from docs.
 *  1. Does ffmpeg.wasm load and convert MP3 -> OGG in a real browser?
 *  2. Which encoders / muxers does THIS core build actually ship?
 *  3. Is the `drawtext` filter present, and does it work without a font file?
 *  4. What does WebCodecs offer as a faster path?
 * Results are written to `window.__spike` for Playwright to read.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

type Result = Record<string, unknown>;
const result: Result = {};
const out = document.getElementById('out')!;
const log = (k: string, v: unknown) => {
  result[k] = v;
  out.textContent = JSON.stringify(result, null, 2);
};

async function main() {
  log('crossOriginIsolated', self.crossOriginIsolated);
  log('sharedArrayBuffer', typeof SharedArrayBuffer !== 'undefined');
  log('webcodecs', typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder !== 'undefined');

  if (typeof VideoEncoder !== 'undefined') {
    const configs = [
      { codec: 'avc1.42001f', width: 640, height: 480, bitrate: 1_000_000 },
      { codec: 'avc1.640028', width: 1920, height: 1080, bitrate: 4_000_000 },
      { codec: 'vp8', width: 640, height: 480, bitrate: 1_000_000 },
      { codec: 'vp09.00.10.08', width: 640, height: 480, bitrate: 1_000_000 },
      { codec: 'av01.0.04M.08', width: 640, height: 480, bitrate: 1_000_000 },
      { codec: 'hev1.1.6.L93.B0', width: 640, height: 480, bitrate: 1_000_000 },
    ];
    const support: Record<string, boolean> = {};
    for (const c of configs) {
      try {
        support[c.codec] = (await VideoEncoder.isConfigSupported(c)).supported === true;
      } catch {
        support[c.codec] = false;
      }
    }
    log('videoEncoderSupport', support);
  }
  if (typeof AudioEncoder !== 'undefined') {
    const support: Record<string, boolean> = {};
    for (const codec of ['mp4a.40.2', 'opus']) {
      try {
        support[codec] = (
          await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2 })
        ).supported === true;
      } catch {
        support[codec] = false;
      }
    }
    log('audioEncoderSupport', support);
  }

  const lines: string[] = [];
  const ffmpeg = new FFmpeg();
  ffmpeg.on('log', ({ message }) => lines.push(message));

  const t0 = performance.now();
  const base = `${location.origin}/ffmpeg/core`;
  await ffmpeg.load({ coreURL: `${base}/ffmpeg-core.js`, wasmURL: `${base}/ffmpeg-core.wasm` });
  log('loadMs', Math.round(performance.now() - t0));
  log('version', lines.find((l) => l.includes('ffmpeg version')) ?? null);

  const capture = async (args: string[]) => {
    lines.length = 0;
    await ffmpeg.exec(args);
    return lines.join('\n');
  };

  const encoders = await capture(['-hide_banner', '-encoders']);
  const muxers = await capture(['-hide_banner', '-muxers']);
  const filters = await capture(['-hide_banner', '-filters']);
  const demuxers = await capture(['-hide_banner', '-demuxers']);

  const pick = (haystack: string, names: string[]) =>
    Object.fromEntries(names.map((n) => [n, new RegExp(`\\b${n}\\b`).test(haystack)]));

  log('encoders', pick(encoders, [
    'libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'libaom-av1', 'mpeg4', 'gif',
    'aac', 'libmp3lame', 'libvorbis', 'libopus', 'flac', 'pcm_s16le', 'png', 'mjpeg', 'libwebp',
  ]));
  log('muxers', pick(muxers, ['mp4', 'webm', 'matroska', 'mp3', 'ogg', 'wav', 'flac', 'ipod', 'gif', 'image2', 'adts', 'opus']));
  log('demuxers', pick(demuxers, ['mov', 'matroska', 'mp3', 'ogg', 'wav', 'flac', 'aac', 'image2', 'lavfi', 'avi']));
  log('filters', pick(filters, [
    'drawtext', 'scale', 'overlay', 'concat', 'atempo', 'rubberband', 'eq', 'fade', 'afade',
    'crop', 'format', 'volume', 'anull', 'amix', 'palettegen', 'paletteuse', 'setpts', 'asetrate', 'aresample', 'firequalizer', 'aecho', 'acompressor', 'highpass', 'lowpass', 'equalizer', 'loudnorm', 'trim', 'colorchannelmixer', 'hue', 'transpose', 'hflip', 'vflip', 'rotate',
  ]));
  log('encodersRaw', encoders.slice(0, 40));

  // The headline check: a real MP3 -> OGG conversion.
  const mp3 = new Uint8Array(await (await fetch('/fixtures/tone.mp3')).arrayBuffer());
  await ffmpeg.writeFile('in.mp3', mp3);
  lines.length = 0;
  const t1 = performance.now();
  const code = await ffmpeg.exec(['-i', 'in.mp3', '-c:a', 'libvorbis', '-q:a', '5', 'out.ogg']);
  const ogg = (await ffmpeg.readFile('out.ogg')) as Uint8Array;
  log('mp3ToOgg', {
    exitCode: code,
    inputBytes: mp3.length,
    outputBytes: ogg.length,
    ms: Math.round(performance.now() - t1),
    magic: String.fromCharCode(...ogg.slice(0, 4)),
  });

  // drawtext without an explicit fontfile: does the build have a usable font?
  lines.length = 0;
  let drawtext: unknown;
  try {
    const dtCode = await ffmpeg.exec([
      '-f', 'lavfi', '-i', 'color=c=black:s=160x120:d=1',
      '-vf', "drawtext=text='Forja':fontcolor=white:fontsize=24:x=10:y=10",
      '-frames:v', '1', 'dt.png',
    ]);
    const png = (await ffmpeg.readFile('dt.png')) as Uint8Array;
    drawtext = { exitCode: dtCode, bytes: png.length, log: lines.slice(-6) };
  } catch (error) {
    drawtext = { error: String(error), log: lines.slice(-6) };
  }
  log('drawtextNoFont', drawtext);

  // lavfi availability matters: we use it to synthesise silence/colour sources.
  lines.length = 0;
  try {
    const c = await ffmpeg.exec(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '1', 's.wav']);
    const wav = (await ffmpeg.readFile('s.wav')) as Uint8Array;
    log('lavfiAnullsrc', { exitCode: c, bytes: wav.length });
  } catch (error) {
    log('lavfiAnullsrc', { error: String(error) });
  }

  log('done', true);
}

main().catch((error) => {
  log('fatal', String(error));
  log('done', true);
});
