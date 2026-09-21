import { createAudio, frameCount, sliceAudio, type AudioData } from '../audio/buffer';
import { fadeIn as applyFadeIn, fadeOut as applyFadeOut } from '../audio/effects';
import { changeSpeedKeepingPitch } from '../audio/timeStretch';
import {
  clipEnd,
  isMediaClip,
  projectDuration,
  type MediaClip,
  type VideoProject,
} from './project';

/**
 * Mixing a project's audio down to one buffer.
 *
 * Done in plain arrays rather than through an `OfflineAudioContext` graph for
 * one specific reason: clips with "keep the pitch" need the time stretcher from
 * the audio editor, and there is no way to put that inside a Web Audio graph.
 * Doing the whole mix here keeps one code path instead of two that could
 * disagree.
 */

export const MIX_SAMPLE_RATE = 48000;

/** Resamples to the mix rate with linear interpolation. */
function resample(audio: AudioData, targetRate: number): AudioData {
  if (audio.sampleRate === targetRate) return audio;
  const ratio = audio.sampleRate / targetRate;
  const frames = Math.max(1, Math.round(frameCount(audio) / ratio));
  const out = createAudio(audio.channels.length, frames, targetRate);

  audio.channels.forEach((channel, index) => {
    const target = out.channels[index]!;
    for (let i = 0; i < frames; i += 1) {
      const source = i * ratio;
      const base = Math.floor(source);
      const fraction = source - base;
      const a = channel[Math.min(channel.length - 1, base)] ?? 0;
      const b = channel[Math.min(channel.length - 1, base + 1)] ?? a;
      target[i] = a + (b - a) * fraction;
    }
  });
  return out;
}

/** The audio a single clip contributes, already trimmed, sped and faded. */
export function renderClipAudio(
  clip: MediaClip,
  source: AudioData,
  sampleRate = MIX_SAMPLE_RATE,
): AudioData {
  const resampled = resample(source, sampleRate);
  const from = Math.round(clip.inPoint * sampleRate);
  // How much source the clip consumes depends on its speed.
  const sourceSpan = Math.round(clip.duration * clip.speed * sampleRate);
  let segment = sliceAudio(resampled, from, from + sourceSpan);
  if (frameCount(segment) === 0) return createAudio(2, 0, sampleRate);

  if (clip.speed !== 1) {
    segment = changeSpeedKeepingPitch(
      segment,
      0,
      frameCount(segment),
      clip.speed,
      clip.keepPitch,
    );
  }

  const wanted = Math.round(clip.duration * sampleRate);
  if (frameCount(segment) !== wanted) {
    // Stretching lands within a frame or two of the target; trimming or padding
    // keeps clips from drifting against the picture over a long timeline.
    const fixed = createAudio(segment.channels.length, wanted, sampleRate);
    segment.channels.forEach((channel, index) => {
      fixed.channels[index]!.set(channel.subarray(0, Math.min(channel.length, wanted)));
    });
    segment = fixed;
  }

  const gain = clip.muted ? 0 : clip.volume;
  if (gain !== 1) {
    segment = {
      sampleRate,
      channels: segment.channels.map((channel) => {
        const out = new Float32Array(channel.length);
        for (let i = 0; i < channel.length; i += 1) out[i] = channel[i]! * gain;
        return out;
      }),
    };
  }

  const frames = frameCount(segment);
  if (clip.fadeIn > 0) {
    segment = applyFadeIn(segment, 0, Math.min(frames, Math.round(clip.fadeIn * sampleRate)));
  }
  if (clip.fadeOut > 0) {
    const fadeFrames = Math.min(frames, Math.round(clip.fadeOut * sampleRate));
    segment = applyFadeOut(segment, frames - fadeFrames, frames);
  }
  return segment;
}

export type AudioSourceLookup = (sourceId: string) => AudioData | undefined;

/**
 * Sums every audible clip into one buffer.
 *
 * Deliberately no limiter: overlapping loud clips can exceed full scale, and
 * quietly squashing them would hide the problem. The exporter reports the peak
 * so the interface can warn instead.
 */
export function mixProject(
  project: VideoProject,
  lookup: AudioSourceLookup,
  sampleRate = MIX_SAMPLE_RATE,
): { audio: AudioData; peak: number } {
  const duration = projectDuration(project);
  const frames = Math.max(1, Math.ceil(duration * sampleRate));
  const mix = createAudio(2, frames, sampleRate);

  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (!isMediaClip(clip) || clip.kind === 'image') continue;
      if (clip.muted || clip.volume === 0) continue;
      const source = lookup(clip.sourceId);
      if (!source) continue;

      const rendered = renderClipAudio(clip, source, sampleRate);
      const offset = Math.round(clip.start * sampleRate);
      const length = Math.min(frameCount(rendered), frames - offset);

      for (let channelIndex = 0; channelIndex < 2; channelIndex += 1) {
        const target = mix.channels[channelIndex]!;
        const from = rendered.channels[channelIndex] ?? rendered.channels[0];
        if (!from) continue;
        for (let i = 0; i < length; i += 1) {
          target[offset + i] = target[offset + i]! + from[i]!;
        }
      }
    }
  }

  let peak = 0;
  for (const channel of mix.channels) {
    for (const value of channel) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }

  return { audio: mix, peak };
}

export { clipEnd };
