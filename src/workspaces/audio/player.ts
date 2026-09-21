import type { AudioData } from '../../core/audio/buffer';

/**
 * Playback for the audio editor.
 *
 * A fresh `AudioBufferSourceNode` per play is not an optimisation choice but a
 * requirement: a source node cannot be started twice. What this class adds is
 * the position tracking (Web Audio gives none), looping over a selection, and
 * a level meter fed from the same graph that is audible, so the meter cannot
 * disagree with what is heard.
 */

export type PlayerState = 'stopped' | 'playing';

export interface PlayRange {
  /** Seconds. */
  readonly start: number;
  readonly end: number;
  readonly loop: boolean;
}

type Listener = () => void;

export class AudioPlayer {
  private context: AudioContext | undefined;
  private source: AudioBufferSourceNode | undefined;
  private analyser: AnalyserNode | undefined;
  private meterBuffer: Float32Array<ArrayBuffer> | undefined;

  private startedAt = 0;
  private startOffset = 0;
  private range: PlayRange | undefined;
  private state: PlayerState = 'stopped';
  private readonly listeners = new Set<Listener>();
  private version = 0;

  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  get playing(): boolean {
    return this.state === 'playing';
  }

  /**
   * Where playback has reached, in seconds.
   *
   * Derived from the audio clock rather than a timer: `setInterval` drifts
   * against the audio hardware and the playhead would slide off the waveform.
   */
  get position(): number {
    if (this.state !== 'playing' || !this.context) return this.startOffset;
    const elapsed = this.context.currentTime - this.startedAt;
    if (!this.range) return this.startOffset + elapsed;
    const span = this.range.end - this.range.start;
    if (span <= 0) return this.range.start;
    return this.range.loop
      ? this.range.start + (elapsed % span)
      : Math.min(this.range.end, this.startOffset + elapsed);
  }

  /** Peak level of the last analysis window, 0–1, for the meter. */
  get level(): number {
    if (!this.analyser || this.state !== 'playing') return 0;
    this.meterBuffer ??= new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(this.meterBuffer);
    let peak = 0;
    for (const value of this.meterBuffer) {
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
    return peak;
  }

  private ensureContext(sampleRate: number): AudioContext {
    // A context locked to a different rate would resample everything, so it is
    // rebuilt when the audio's rate changes.
    if (this.context && this.context.sampleRate !== sampleRate) {
      void this.context.close();
      this.context = undefined;
    }
    if (!this.context) {
      const Ctor =
        globalThis.AudioContext ??
        (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) throw new Error('Web Audio is unavailable in this browser');
      this.context = new Ctor({ sampleRate });
    }
    return this.context;
  }

  play(audio: AudioData, range: PlayRange): void {
    this.stop();
    const context = this.ensureContext(audio.sampleRate);
    void context.resume();

    const buffer = context.createBuffer(
      audio.channels.length,
      Math.max(1, audio.channels[0]?.length ?? 1),
      audio.sampleRate,
    );
    audio.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));

    const source = context.createBufferSource();
    source.buffer = buffer;

    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    analyser.connect(context.destination);

    const span = Math.max(0, range.end - range.start);
    if (range.loop && span > 0) {
      source.loop = true;
      source.loopStart = range.start;
      source.loopEnd = range.end;
      source.start(0, range.start);
    } else if (span > 0) {
      source.start(0, range.start, span);
    } else {
      source.start(0, range.start);
    }

    source.onended = () => {
      // A loop never ends on its own; anything else has finished.
      if (this.source === source && !source.loop) this.stop();
    };

    this.source = source;
    this.analyser = analyser;
    this.startedAt = context.currentTime;
    this.startOffset = range.start;
    this.range = range;
    this.state = 'playing';
    this.emit();
  }

  stop(): void {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        // Already stopped; nothing to do.
      }
      this.source.disconnect();
      this.source = undefined;
    }
    this.analyser?.disconnect();
    this.analyser = undefined;
    if (this.state !== 'stopped') {
      this.startOffset = this.position;
      this.state = 'stopped';
      this.emit();
    }
  }

  seek(seconds: number): void {
    this.startOffset = Math.max(0, seconds);
    if (this.state === 'playing') this.stop();
    else this.emit();
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = undefined;
    this.listeners.clear();
  }
}
