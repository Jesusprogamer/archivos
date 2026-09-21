/**
 * An 8-bit array that is definitely backed by a plain `ArrayBuffer`.
 *
 * TypeScript's DOM types accept only `ArrayBuffer`-backed arrays in
 * `ImageData`, while a bare `Uint8ClampedArray` may be backed by a
 * `SharedArrayBuffer`. Every array built here is a plain one, so narrowing the
 * type once keeps casts out of the rest of the code.
 */
export type ByteArray = Uint8ClampedArray<ArrayBuffer>;

export function bytes(length: number): ByteArray;
export function bytes(source: ArrayLike<number>): ByteArray;
export function bytes(argument: number | ArrayLike<number>): ByteArray {
  return typeof argument === 'number'
    ? new Uint8ClampedArray(argument)
    : new Uint8ClampedArray(argument);
}
