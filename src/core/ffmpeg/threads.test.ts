import { describe, expect, it, vi } from 'vitest';
import { x264Threads, x264ThreadArgs } from './threads';

describe('x264Threads', () => {
  it('never returns zero, which ffmpeg reads as "decide for me"', () => {
    // «Decide tú» es justo lo que se cae: el núcleo multihilo no tiene tantos
    // hilos como núcleos dice la máquina (PLAN §3.8).
    vi.stubGlobal('navigator', { hardwareConcurrency: 0 });
    expect(x264Threads()).toBeGreaterThan(0);
    vi.unstubAllGlobals();
  });

  it('caps at four, past which nothing measurable was gained', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 64 });
    expect(x264Threads()).toBe(4);
    vi.unstubAllGlobals();
  });

  it('does not ask for more threads than the machine has', () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    expect(x264Threads()).toBe(2);
    vi.unstubAllGlobals();
  });
});

describe('x264ThreadArgs', () => {
  it('produces a flag ffmpeg understands', () => {
    const args = x264ThreadArgs();
    expect(args[0]).toBe('-threads');
    expect(Number(args[1])).toBeGreaterThan(0);
  });
});
