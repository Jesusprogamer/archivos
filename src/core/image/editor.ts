import { stampBrush, strokeBrush, type BrushMode, type BrushSettings, type Rect } from './brush';
import { bytes, type ByteArray } from './bytes';
import { applyKey, computeColorKey, type ColorKeyParams } from './colorKey';
import { History, createState, type DocumentState } from './document';
import { crop, fitSize, resampleMask, rotateFlip, type CropRect, type QuarterTurns } from './transform';

/**
 * The image editing engine.
 *
 * Deliberately free of React. The interface subscribes to it, but the engine
 * itself is a plain object that owns pixels, mask, history and the pending
 * preview — which is what makes it testable without a DOM and reusable from a
 * worker later on.
 *
 * Pixels and mask stay separate throughout. That separation is what lets the
 * three background-removal methods stack in any order: each one writes into the
 * same mask, and the original pixels are never destroyed, so nothing is ever
 * irreversible.
 */

export interface Adjustments {
  /** Percentages, 100 meaning unchanged. */
  readonly brightness: number;
  readonly contrast: number;
  readonly saturation: number;
}

export const NEUTRAL_ADJUSTMENTS: Adjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};

export function adjustmentsFilter(adjustments: Adjustments): string {
  return `brightness(${adjustments.brightness}%) contrast(${adjustments.contrast}%) saturate(${adjustments.saturation}%)`;
}

export function isNeutral(adjustments: Adjustments): boolean {
  return (
    adjustments.brightness === 100 && adjustments.contrast === 100 && adjustments.saturation === 100
  );
}

/** Paints pixels through a canvas filter and reads the result back. */
function bakeFilter(state: DocumentState, filter: string): ByteArray {
  const source = new OffscreenCanvas(state.width, state.height);
  source
    .getContext('2d')
    ?.putImageData(new ImageData(bytes(state.pixels), state.width, state.height), 0, 0);

  const canvas = new OffscreenCanvas(state.width, state.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D context unavailable');
  context.filter = filter;
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, state.width, state.height).data;
}

/** Resamples pixels through the canvas, which does it better than we would. */
function resizePixels(state: DocumentState, width: number, height: number): ByteArray {
  const source = new OffscreenCanvas(state.width, state.height);
  source
    .getContext('2d')
    ?.putImageData(new ImageData(bytes(state.pixels), state.width, state.height), 0, 0);

  const target = new OffscreenCanvas(width, height);
  const context = target.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D context unavailable');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

type Listener = () => void;

export class ImageEditor {
  private state: DocumentState;
  private readonly history = new History();
  private preview: ByteArray | undefined;
  private strokeFrom: { x: number; y: number } | undefined;
  private readonly listeners = new Set<Listener>();
  private version = 0;
  private changed = false;

  constructor(pixels: ByteArray, width: number, height: number) {
    this.state = createState(bytes(pixels), { width, height });
  }

  // ---- Subscription, for `useSyncExternalStore` ----
  readonly subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A counter, so a consumer can tell "something changed" without comparing. */
  readonly getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  // ---- Reading ----
  getState(): DocumentState {
    return this.state;
  }

  /** The uncommitted mask, drawn in place of the real one while previewing. */
  getPreview(): ByteArray | undefined {
    return this.preview;
  }

  get canUndo(): boolean {
    return this.history.canUndo;
  }

  get canRedo(): boolean {
    return this.history.canRedo;
  }

  /** True once anything has been edited, so the UI can offer to export. */
  get isDirty(): boolean {
    return this.changed;
  }

  // ---- History ----
  private replace(next: DocumentState): void {
    this.history.push(this.state);
    this.state = next;
    this.preview = undefined;
    this.changed = true;
    this.emit();
  }

  undo(): void {
    const previous = this.history.undo(this.state);
    if (!previous) return;
    this.state = previous;
    this.preview = undefined;
    this.emit();
  }

  redo(): void {
    const next = this.history.redo(this.state);
    if (!next) return;
    this.state = next;
    this.preview = undefined;
    this.emit();
  }

  // ---- Previews ----
  previewColorKey(params: ColorKeyParams): void {
    this.preview = applyKey(this.state.mask, computeColorKey(this.state, params));
    this.emit();
  }

  /** Feeds in a mask from elsewhere — the model, typically — as a preview. */
  previewMask(mask: ByteArray): void {
    this.preview = applyKey(this.state.mask, mask);
    this.emit();
  }

  clearPreview(): void {
    if (!this.preview) return;
    this.preview = undefined;
    this.emit();
  }

  commitPreview(): void {
    if (!this.preview) return;
    this.replace({ ...this.state, mask: this.preview });
  }

  // ---- Brush ----
  beginStroke(x: number, y: number, settings: BrushSettings, mode: BrushMode): void {
    // One history entry per stroke, not per stamp.
    this.history.push(this.state);
    this.changed = true;
    this.strokeFrom = { x, y };
    stampBrush(this.state.mask, this.state.width, this.state.height, x, y, settings, mode);
    this.emit();
  }

  continueStroke(x: number, y: number, settings: BrushSettings, mode: BrushMode): Rect {
    const from = this.strokeFrom ?? { x, y };
    const dirty = strokeBrush(
      this.state.mask,
      this.state.width,
      this.state.height,
      from,
      { x, y },
      settings,
      mode,
    );
    this.strokeFrom = { x, y };
    // The canvas repaints from the same buffer, so a notification is enough.
    this.emit();
    return dirty;
  }

  endStroke(): void {
    this.strokeFrom = undefined;
  }

  // ---- Geometry ----
  crop(rect: CropRect): void {
    this.replace(crop(this.state, rect));
  }

  rotateFlip(turns: QuarterTurns, flipX = false, flipY = false): void {
    if (turns === 0 && !flipX && !flipY) return;
    this.replace(rotateFlip(this.state, turns, flipX, flipY));
  }

  resize(target: { width?: number; height?: number }): void {
    const size = fitSize(this.state.width, this.state.height, target);
    if (size.width === this.state.width && size.height === this.state.height) return;
    const current = this.state;
    const pixels = resizePixels(current, size.width, size.height);
    this.replace({
      width: size.width,
      height: size.height,
      pixels,
      mask: resampleMask(current.mask, current.width, current.height, size.width, size.height),
    });
  }

  // ---- Colour ----
  applyAdjustments(adjustments: Adjustments): void {
    if (isNeutral(adjustments)) return;
    const baked = bakeFilter(this.state, adjustmentsFilter(adjustments));
    this.replace({ ...this.state, pixels: baked });
  }

  /** Puts every pixel back, without touching crops or colour changes. */
  resetMask(): void {
    const mask = bytes(this.state.width * this.state.height);
    mask.fill(255);
    this.replace({ ...this.state, mask });
  }

  dispose(): void {
    this.history.clear();
    this.listeners.clear();
    this.preview = undefined;
  }
}
