import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { AudioData } from '../../core/audio/buffer';
import { AudioEditor } from '../../core/audio/editor';
import { AudioPlayer } from './player';

/** Binds the React-free audio editor and player to a component. */
export function useAudioEditor(audio: AudioData): {
  editor: AudioEditor;
  version: number;
} {
  const editor = useMemo(() => new AudioEditor(audio), [audio]);
  const version = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);
  useEffect(() => () => editor.dispose(), [editor]);
  return { editor, version };
}

export function useAudioPlayer(): { player: AudioPlayer; version: number } {
  const player = useMemo(() => new AudioPlayer(), []);
  const version = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  useEffect(() => () => player.dispose(), [player]);
  return { player, version };
}

/**
 * A ticker for things Web Audio does not notify about: the playhead position
 * and the level meter. It runs only while something is playing, so an idle
 * editor costs nothing.
 *
 * Written as a class rather than a closure in `useMemo` so its mutable state
 * lives outside React's render cycle, where mutable state belongs.
 */
class FrameTicker {
  private frame = 0;
  private handle = 0;
  private running = false;
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.frame;

  private readonly loop = (): void => {
    this.frame += 1;
    for (const listener of this.listeners) listener();
    if (this.running) this.handle = requestAnimationFrame(this.loop);
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.handle = requestAnimationFrame(this.loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.handle);
  }
}

export function useAnimationTick(active: boolean): number {
  const ticker = useMemo(() => new FrameTicker(), []);

  useEffect(() => {
    if (active) ticker.start();
    else ticker.stop();
    return () => ticker.stop();
  }, [active, ticker]);

  return useSyncExternalStore(ticker.subscribe, ticker.getSnapshot, ticker.getSnapshot);
}
