import {
  audioBytes,
  cloneAudio,
  cutRange,
  durationOf,
  frameAt,
  frameCount,
  insertAudio,
  insertSilence,
  isEmptySelection,
  rangeOf,
  sliceAudio,
  type AudioData,
  type Selection,
} from './buffer';
import { DIRECT_EFFECTS, applyDirect, type EffectSettings } from './effects';
import { renderEffect } from './render';
import { changeSpeedKeepingPitch, shiftPitch } from './timeStretch';

/**
 * The audio editing engine.
 *
 * Like the image editor, it is free of React: it owns the samples, the
 * selection, the clipboard and the history, and notifies subscribers when
 * something changes.
 *
 * Effects are not destructive until they are applied. `preview()` computes the
 * result and keeps it aside; the waveform and playback both read the preview
 * when there is one, so what you hear before pressing Apply is exactly what you
 * get after.
 */

type Listener = () => void;

export class AudioEditor {
  private audio: AudioData;
  private preview: AudioData | undefined;
  private clipboard: AudioData | undefined;
  private selection: Selection | undefined;
  /**
   * Where an insertion goes, in seconds.
   *
   * Kept apart from the selection on purpose. A collapsed drag is a cursor
   * position, not "no selection": an effect with nothing selected should apply
   * to the whole track, while pasting with nothing selected should land where
   * the cursor is. Folding the two together makes one of those two wrong.
   */
  private playhead = 0;

  private readonly past: AudioData[] = [];
  private readonly future: AudioData[] = [];
  private historyBytes = 0;

  private readonly listeners = new Set<Listener>();
  /**
   * Which preview request is current.
   *
   * Dragging a slider fires a request per frame and some effects take tens of
   * milliseconds, so results can arrive out of order. Only the newest token is
   * allowed to write, which keeps a stale result from overwriting a fresh one.
   */
  private previewToken = 0;
  private computing = false;
  private version = 0;
  /** Increments only when the samples change, so the waveform cache can key on it. */
  private revisionCounter = 0;
  private changed = false;

  constructor(
    audio: AudioData,
    private readonly budgetBytes = 512 * 1024 * 1024,
  ) {
    this.audio = audio;
  }

  // ---- Subscription ----
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.version;

  private emit(samplesChanged: boolean): void {
    this.version += 1;
    if (samplesChanged) this.revisionCounter += 1;
    for (const listener of this.listeners) listener();
  }

  // ---- Reading ----
  /** The audio to draw and play: the preview if there is one, else the real thing. */
  get current(): AudioData {
    return this.preview ?? this.audio;
  }

  get committed(): AudioData {
    return this.audio;
  }

  get hasPreview(): boolean {
    return this.preview !== undefined;
  }

  /** True while a preview is being computed, so the UI can say so. */
  get isComputing(): boolean {
    return this.computing;
  }

  get revision(): number {
    return this.revisionCounter;
  }

  get duration(): number {
    return durationOf(this.current);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get isDirty(): boolean {
    return this.changed;
  }

  get hasClipboard(): boolean {
    return this.clipboard !== undefined;
  }

  getSelection(): Selection | undefined {
    return this.selection;
  }

  getPlayhead(): number {
    return this.playhead;
  }

  setPlayhead(seconds: number): void {
    this.playhead = Math.max(0, Math.min(seconds, this.duration));
    this.emit(false);
  }

  /** Where an insertion lands: the start of the selection, or the cursor. */
  private insertFrame(): number {
    if (this.selection && !isEmptySelection(this.selection)) {
      return frameAt(this.audio, this.selection.start);
    }
    return frameAt(this.audio, this.playhead);
  }

  /** The frame range an operation would touch: the selection, or everything. */
  getRange(): [number, number] {
    return rangeOf(this.current, this.selection);
  }

  setSelection(selection: Selection | undefined): void {
    this.selection = selection;
    if (selection) this.playhead = selection.start;
    this.emit(false);
  }

  // ---- History ----
  private commit(next: AudioData): void {
    this.past.push(this.audio);
    this.historyBytes += audioBytes(this.audio);
    this.future.length = 0;
    // Bound the history by memory: one snapshot of a ten-minute stereo track
    // is 200 MB, and a fixed step count would either be stingy or fatal.
    while (this.past.length > 1 && this.historyBytes > this.budgetBytes) {
      const dropped = this.past.shift();
      if (dropped) this.historyBytes -= audioBytes(dropped);
    }
    this.audio = next;
    this.preview = undefined;
    this.changed = true;
    this.emit(true);
  }

  undo(): void {
    const previous = this.past.pop();
    if (!previous) return;
    this.historyBytes -= audioBytes(previous);
    this.future.push(this.audio);
    this.audio = previous;
    this.preview = undefined;
    this.clampSelection();
    this.emit(true);
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(this.audio);
    this.historyBytes += audioBytes(this.audio);
    this.audio = next;
    this.preview = undefined;
    this.clampSelection();
    this.emit(true);
  }

  /** Keeps the selection inside the audio after an edit changed its length. */
  private clampSelection(): void {
    if (!this.selection) return;
    const total = durationOf(this.audio);
    const start = Math.max(0, Math.min(this.selection.start, total));
    const end = Math.max(start, Math.min(this.selection.end, total));
    this.selection = end - start < 1e-6 ? undefined : { start, end };
    this.playhead = Math.max(0, Math.min(this.playhead, total));
  }

  // ---- Editing ----
  cut(): void {
    const [from, to] = this.getRange();
    if (to <= from) return;
    this.clipboard = sliceAudio(this.audio, from, to);
    this.commit(cutRange(this.audio, from, to));
    this.selection = undefined;
  }

  copy(): void {
    const [from, to] = this.getRange();
    if (to <= from) return;
    this.clipboard = sliceAudio(this.audio, from, to);
    this.emit(false);
  }

  paste(): void {
    if (!this.clipboard) return;
    const at = this.insertFrame();
    // Pasting over a selection replaces it, which is what every editor does.
    if (this.selection && !isEmptySelection(this.selection)) {
      const [from, to] = this.getRange();
      this.commit(insertAudio(cutRange(this.audio, from, to), this.clipboard, from));
      this.selection = undefined;
      return;
    }
    this.commit(insertAudio(this.audio, this.clipboard, at));
  }

  deleteRange(): void {
    const [from, to] = this.getRange();
    if (to <= from || !this.selection) return;
    this.commit(cutRange(this.audio, from, to));
    this.selection = undefined;
  }

  /** Keeps the selection and throws away everything else. */
  trimToSelection(): void {
    const [from, to] = this.getRange();
    if (to <= from || !this.selection) return;
    this.commit(sliceAudio(this.audio, from, to));
    this.selection = undefined;
  }

  insertSilence(seconds: number): void {
    this.commit(insertSilence(this.audio, this.insertFrame(), seconds));
  }

  // ---- Effects ----
  /**
   * Computes an effect without committing it.
   *
   * Everything — the waveform, the meter, playback — reads `current`, so the
   * preview is heard and seen exactly as it will be applied.
   */
  async previewEffect(effect: EffectSettings): Promise<void> {
    const token = ++this.previewToken;
    this.computing = true;
    this.emit(false);

    const [from, to] = rangeOf(this.audio, this.selection);
    try {
      const result = await this.compute(this.audio, from, to, effect);
      if (token !== this.previewToken) return;
      this.preview = result;
      this.computing = false;
      this.emit(true);
    } catch (error) {
      if (token !== this.previewToken) return;
      this.computing = false;
      this.emit(false);
      throw error;
    }
  }

  private async compute(
    audio: AudioData,
    from: number,
    to: number,
    effect: EffectSettings,
  ): Promise<AudioData> {
    if (DIRECT_EFFECTS.has(effect.id)) return applyDirect(audio, from, to, effect);
    if (effect.id === 'speed') {
      return changeSpeedKeepingPitch(
        audio,
        from,
        to,
        effect.settings.rate,
        effect.settings.keepPitch,
      );
    }
    if (effect.id === 'pitch') return shiftPitch(audio, from, to, effect.settings.semitones);
    return renderEffect(audio, from, to, effect);
  }

  applyPreview(): void {
    if (!this.preview) return;
    this.previewToken += 1;
    const next = this.preview;
    this.preview = undefined;
    this.commit(next);
    this.clampSelection();
  }

  discardPreview(): void {
    // Bumping the token cancels any computation still in flight.
    this.previewToken += 1;
    this.computing = false;
    if (!this.preview) {
      this.emit(false);
      return;
    }
    this.preview = undefined;
    this.emit(true);
  }

  /** Replaces the whole buffer — used when an effect is applied elsewhere. */
  replace(audio: AudioData): void {
    this.commit(audio);
  }

  selectAll(): void {
    this.selection = { start: 0, end: durationOf(this.audio) };
    this.emit(false);
  }

  clearSelection(): void {
    this.selection = undefined;
    this.emit(false);
  }

  dispose(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.listeners.clear();
    this.preview = undefined;
    this.clipboard = undefined;
  }
}

export { cloneAudio, frameCount };
