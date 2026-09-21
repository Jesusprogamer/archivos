import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ByteArray } from '../../core/image/bytes';
import { ImageEditor } from '../../core/image/editor';

/**
 * Binds the React-free editor to a component.
 *
 * `useSyncExternalStore` is the right tool here: the editor mutates typed
 * arrays in place for speed, and this is how React is told to re-read them
 * without the editor having to know React exists.
 */
export function useImageEditor(
  pixels: ByteArray,
  width: number,
  height: number,
): { editor: ImageEditor; version: number } {
  const editor = useMemo(() => new ImageEditor(pixels, width, height), [pixels, width, height]);
  const version = useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);

  useEffect(() => () => editor.dispose(), [editor]);

  return { editor, version };
}
