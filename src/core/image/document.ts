import { bytes, type ByteArray } from './bytes';
/**
 * The image document.
 *
 * Pixels and the alpha mask are kept apart on purpose. The three
 * background-removal methods all write into the same mask, which is what lets
 * them be combined in any order: pick a colour, refine with the brush, run the
 * model, brush again. The original pixels are never destroyed, so any mask edit
 * is reversible without re-decoding the file.
 */

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Everything a render needs, and the unit of undo. */
export interface DocumentState {
  readonly width: number;
  readonly height: number;
  /** RGBA of the image after crops, resizes and colour adjustments. */
  readonly pixels: ByteArray;
  /** One byte per pixel: 255 keeps it, 0 removes it, between is a soft edge. */
  readonly mask: ByteArray;
}

export function createState(pixels: ByteArray, size: Size): DocumentState {
  const mask = bytes(size.width * size.height);
  mask.fill(255);
  return { width: size.width, height: size.height, pixels, mask };
}

export function cloneState(state: DocumentState): DocumentState {
  return {
    width: state.width,
    height: state.height,
    pixels: bytes(state.pixels),
    mask: bytes(state.mask),
  };
}

/** Approximate heap cost of a state, used to bound the history. */
export function stateBytes(state: DocumentState): number {
  return state.pixels.byteLength + state.mask.byteLength;
}

/**
 * Undo history with a memory budget rather than a fixed depth.
 *
 * A 60-megapixel photo and a 200×200 icon should not get the same number of
 * steps: one snapshot of the first is 300 MB, of the second is 160 kB. Counting
 * bytes keeps a small image's history generous and a huge image's history from
 * exhausting the tab.
 */
export class History {
  private readonly past: DocumentState[] = [];
  private readonly future: DocumentState[] = [];
  private bytes = 0;

  constructor(private readonly budgetBytes = 384 * 1024 * 1024) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  get depth(): number {
    return this.past.length;
  }

  /** Records the state *before* a change. Call it just before mutating. */
  push(state: DocumentState): void {
    this.past.push(cloneState(state));
    this.bytes += stateBytes(state);
    this.future.length = 0;
    this.trim();
  }

  undo(current: DocumentState): DocumentState | undefined {
    const previous = this.past.pop();
    if (!previous) return undefined;
    this.bytes -= stateBytes(previous);
    this.future.push(cloneState(current));
    return previous;
  }

  redo(current: DocumentState): DocumentState | undefined {
    const next = this.future.pop();
    if (!next) return undefined;
    this.past.push(cloneState(current));
    this.bytes += stateBytes(current);
    return next;
  }

  clear(): void {
    this.past.length = 0;
    this.future.length = 0;
    this.bytes = 0;
  }

  private trim(): void {
    // Always keep at least one step: an editor where undo sometimes does
    // nothing is worse than one with a short history.
    while (this.past.length > 1 && this.bytes > this.budgetBytes) {
      const dropped = this.past.shift();
      if (dropped) this.bytes -= stateBytes(dropped);
    }
  }
}

/**
 * Writes the mask into the alpha channel of a copy of the pixels, ready for
 * `putImageData`.
 */
export function composite(state: DocumentState, into?: ByteArray): ByteArray {
  const out = into ?? bytes(state.pixels.length);
  const { pixels, mask } = state;
  for (let i = 0, p = 0; i < mask.length; i += 1, p += 4) {
    out[p] = pixels[p]!;
    out[p + 1] = pixels[p + 1]!;
    out[p + 2] = pixels[p + 2]!;
    // The source alpha still counts: a PNG that was already partly transparent
    // must not become opaque just because the mask keeps the pixel.
    out[p + 3] = (pixels[p + 3]! * mask[i]!) / 255;
  }
  return out;
}
