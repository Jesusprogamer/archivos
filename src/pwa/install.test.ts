// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { detectDisplayMode, isAppleTouchDevice } from './install';

function withMatchMedia(matching: string[]): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: matching.includes(query),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

describe('detectDisplayMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is "browser" in a normal tab', () => {
    withMatchMedia([]);
    expect(detectDisplayMode()).toBe('browser');
  });

  it('is "installed" in a standalone window', () => {
    withMatchMedia(['(display-mode: standalone)']);
    expect(detectDisplayMode()).toBe('installed');
  });

  it('counts minimal-ui as installed, which is what some launchers use', () => {
    withMatchMedia(['(display-mode: minimal-ui)']);
    expect(detectDisplayMode()).toBe('installed');
  });

  it('falls back to navigator.standalone, the only signal Safari on iOS gives', () => {
    withMatchMedia([]);
    vi.stubGlobal('navigator', { standalone: true });
    expect(detectDisplayMode()).toBe('installed');
  });
});

describe('isAppleTouchDevice', () => {
  const IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
  const IPAD =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
  const MAC = IPAD;
  const ANDROID =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36';

  it('recognises an iPhone', () => {
    expect(isAppleTouchDevice(IPHONE, 5)).toBe(true);
  });

  it('recognises an iPad, which lies and claims to be a Mac', () => {
    expect(isAppleTouchDevice(IPAD, 5)).toBe(true);
  });

  it('does not mistake a desktop Mac for one: no touch screen', () => {
    expect(isAppleTouchDevice(MAC, 0)).toBe(false);
  });

  it('leaves Android alone, where the install prompt works properly', () => {
    expect(isAppleTouchDevice(ANDROID, 5)).toBe(false);
  });
});
