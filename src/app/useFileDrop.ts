import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Window-wide drag-and-drop plus clipboard paste.
 *
 * Counting enter/leave events is necessary because moving the pointer over a
 * child element fires `dragleave` on the parent; a naive boolean flickers.
 */
export function useFileDrop(onFiles: (files: File[]) => void, enabled = true) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);

  // Keeping the callback in a ref means the window listeners below are
  // attached once, rather than being torn down on every render.
  useEffect(() => {
    handler.current = onFiles;
  }, [onFiles]);

  const emit = useCallback((list: FileList | null | undefined) => {
    const files = [...(list ?? [])].filter((file) => file.size > 0);
    if (files.length > 0) handler.current(files);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onDragEnter = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes('Files')) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      emit(event.dataTransfer.files);
    };
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Let a paste into a text field be a text paste.
      if (target?.closest('input, textarea, [contenteditable]')) return;
      emit(event.clipboardData?.files);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
    };
  }, [enabled, emit]);

  return { dragging };
}

/** The platform's modifier name, for shortcut hints. */
export function modifierLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl';
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}
