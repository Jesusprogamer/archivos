/** What sits behind the subject once the background is gone. */
export type Backdrop =
  | { readonly kind: 'none' }
  | { readonly kind: 'color'; readonly color: string }
  | { readonly kind: 'image'; readonly image: ImageBitmap | undefined; readonly name: string };

export const NO_BACKDROP: Backdrop = { kind: 'none' };

/** A small, deliberately neutral set; the picker covers everything else. */
export const BACKDROP_SWATCHES = [
  '#ffffff',
  '#000000',
  '#f5f0e8',
  '#1f6feb',
  '#2da44e',
  '#d1242f',
  '#8250df',
  '#e3b341',
] as const;
