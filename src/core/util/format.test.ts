import { describe, expect, it } from 'vitest';
import { baseName, formatBytes, formatDuration, formatTimecode, safeFileName } from './format';

describe('formatBytes', () => {
  it('scales and rounds sensibly', () => {
    expect(formatBytes(0, 'en')).toBe('0 B');
    expect(formatBytes(999, 'en')).toBe('999 B');
    expect(formatBytes(1000, 'en')).toBe('1 kB');
    expect(formatBytes(1_500_000, 'en')).toBe('1.5 MB');
    expect(formatBytes(15_000_000, 'en')).toBe('15 MB');
    expect(formatBytes(2_400_000_000, 'en')).toBe('2.4 GB');
  });

  it('refuses to invent a value', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('drops the hour when there is none', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(3599)).toBe('59:59');
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(7384)).toBe('2:03:04');
  });
});

describe('formatTimecode', () => {
  it('keeps hundredths', () => {
    expect(formatTimecode(0)).toBe('0:00.00');
    expect(formatTimecode(1.5)).toBe('0:01.50');
    expect(formatTimecode(61.239)).toBe('1:01.23');
  });
});

describe('name helpers', () => {
  it('strips one extension only', () => {
    expect(baseName('song.mp3')).toBe('song');
    expect(baseName('my.song.mp3')).toBe('my.song');
    expect(baseName('.hidden')).toBe('.hidden');
    expect(baseName('plain')).toBe('plain');
  });

  it('removes characters that break downloads', () => {
    expect(safeFileName('a/b:c*d?.png')).toBe('a_b_c_d_.png');
    expect(safeFileName('')).toBe('forja');
  });
});
