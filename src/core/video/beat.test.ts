import { describe, expect, it } from 'vitest';
import { createAudio } from '../audio/buffer';
import { analyseAudioBeat, bassAt, EMPTY_BEAT, punchScale } from './beat';

/** Un tono grave puro: justo lo que el análisis debe encontrar. */
function bassTone(seconds: number, frequency = 60): ReturnType<typeof createAudio> {
  const rate = 48000;
  const audio = createAudio(1, Math.round(seconds * rate), rate);
  const channel = audio.channels[0]!;
  for (let i = 0; i < channel.length; i += 1) {
    channel[i] = Math.sin((2 * Math.PI * frequency * i) / rate) * 0.9;
  }
  return audio;
}

describe('punchScale', () => {
  it('leaves the clip alone when the effect is off', () => {
    expect(punchScale(0, 1)).toBe(1);
  });

  it('grows the clip with the bass, and by 18% at full strength', () => {
    // El mismo factor que usa el visualizador, para que se reconozca como el
    // mismo efecto cuando se montan juntos.
    expect(punchScale(1, 1)).toBeCloseTo(1.18, 5);
    expect(punchScale(0.5, 1)).toBeCloseTo(1.09, 5);
    expect(punchScale(1, 0)).toBe(1);
  });
});

describe('bassAt', () => {
  it('is silent when there is nothing analysed', () => {
    expect(bassAt(EMPTY_BEAT, 1)).toBe(0);
  });

  it('interpolates between analysis frames', () => {
    const track = { fps: 10, bass: new Float32Array([0, 1]) };
    expect(bassAt(track, 0)).toBeCloseTo(0, 5);
    expect(bassAt(track, 0.05)).toBeCloseTo(0.5, 5);
    expect(bassAt(track, 0.1)).toBeCloseTo(1, 5);
  });

  it('holds the last value past the end instead of snapping to zero', () => {
    const track = { fps: 10, bass: new Float32Array([0, 1]) };
    expect(bassAt(track, 99)).toBeCloseTo(1, 5);
  });

  it('never reads before the start', () => {
    const track = { fps: 10, bass: new Float32Array([0.4, 1]) };
    expect(bassAt(track, -5)).toBeCloseTo(0.4, 5);
  });
});

describe('analyseAudioBeat', () => {
  it('finds energy in a low tone', () => {
    const track = analyseAudioBeat(bassTone(1));
    expect(track.bass.length).toBeGreaterThan(30);
    const peak = Math.max(...track.bass);
    expect(peak).toBeGreaterThan(0.3);
  });

  it('finds almost nothing in a high tone, which is the point of "bass"', () => {
    const low = Math.max(...analyseAudioBeat(bassTone(1, 60)).bass);
    const high = Math.max(...analyseAudioBeat(bassTone(1, 8000)).bass);
    expect(high).toBeLessThan(low / 2);
  });

  it('is silent for silence', () => {
    const track = analyseAudioBeat(createAudio(1, 48000, 48000));
    expect(Math.max(...track.bass)).toBe(0);
  });
});
