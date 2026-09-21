import { useCallback, useEffect, useRef, useState } from 'react';
import { composite, type DocumentState } from '../../core/image/document';
import { cx } from '../../ui/cx';
import styles from './Image.module.css';
import type { Backdrop } from './backdrop';
import { bytes, type ByteArray } from '../../core/image/bytes';

export interface Viewport {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export type CanvasMode = 'pan' | 'eyedrop' | 'brush' | 'crop';

export interface ImageCanvasProps {
  state: DocumentState;
  /** Uncommitted mask drawn instead of the document's own. */
  previewMask: ByteArray | undefined;
  /** Live colour adjustments, applied as a canvas filter. */
  filter: string;
  backdrop: Backdrop;
  /** Bumped by the editor when the document changed in place. */
  version: number;
  mode: CanvasMode;
  brushSize: number;
  viewport: Viewport;
  onViewportChange: (viewport: Viewport) => void;
  onPickColor?: (x: number, y: number) => void;
  onStrokeStart?: (x: number, y: number, erase: boolean) => void;
  onStrokeMove?: (x: number, y: number, erase: boolean) => void;
  onStrokeEnd?: () => void;
  /** Called while dragging a crop rectangle, in image coordinates. */
  onCropDrag?: (rect: { x: number; y: number; width: number; height: number }) => void;
  /** Drawn on top of the picture, inside the same transform. */
  overlay?: React.ReactNode;
  /** Fires with the viewport's size whenever it changes, including on mount. */
  onViewportResize?: (size: { width: number; height: number }) => void;
}

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 32;

/**
 * The canvas view.
 *
 * Two canvases are stacked: the backdrop (a colour or an image placed behind
 * the subject) and the composited picture. Keeping them apart means changing
 * the backdrop never re-composites a sixty-megapixel image, and the
 * transparency checkerboard shows through wherever no backdrop is set.
 */
export function ImageCanvas({
  state,
  previewMask,
  filter,
  backdrop,
  version,
  mode,
  brushSize,
  viewport,
  onViewportChange,
  onPickColor,
  onStrokeStart,
  onStrokeMove,
  onStrokeEnd,
  onCropDrag,
  overlay,
  onViewportResize,
}: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const backdropRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const buffer = useRef<ByteArray | undefined>(undefined);
  const painting = useRef<{ erase: boolean } | undefined>(undefined);
  const panning = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | undefined>(undefined);
  const cropping = useRef<{ x: number; y: number } | undefined>(undefined);
  const [cursor, setCursor] = useState<{ x: number; y: number } | undefined>(undefined);

  // ---- Compositing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = state.width;
    canvas.height = state.height;
    const context = canvas.getContext('2d');
    if (!context) return;

    if (!buffer.current || buffer.current.length !== state.pixels.length) {
      buffer.current = bytes(state.pixels.length);
    }
    const source = previewMask ? { ...state, mask: previewMask } : state;
    const data = composite(source, buffer.current);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.putImageData(new ImageData(data, state.width, state.height), 0, 0);
  }, [state, previewMask, version]);

  // ---- Backdrop ----
  useEffect(() => {
    const canvas = backdropRef.current;
    if (!canvas) return;
    canvas.width = state.width;
    canvas.height = state.height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);

    if (backdrop.kind === 'color') {
      context.fillStyle = backdrop.color;
      context.fillRect(0, 0, canvas.width, canvas.height);
    } else if (backdrop.kind === 'image' && backdrop.image) {
      // Cover, so the backdrop never stretches out of proportion.
      const scale = Math.max(
        canvas.width / backdrop.image.width,
        canvas.height / backdrop.image.height,
      );
      const w = backdrop.image.width * scale;
      const h = backdrop.image.height * scale;
      context.drawImage(backdrop.image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    }
  }, [backdrop, state.width, state.height]);

  // ---- Coordinate mapping ----
  const toImage = useCallback(
    (event: { clientX: number; clientY: number }): { x: number; y: number } | undefined => {
      const canvas = canvasRef.current;
      if (!canvas) return undefined;
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((event.clientX - rect.left) / rect.width) * state.width,
        y: ((event.clientY - rect.top) / rect.height) * state.height,
      };
    },
    [state.width, state.height],
  );

  // ---- Size reporting, so the workspace can fit the image on first paint ----
  useEffect(() => {
    const node = viewportRef.current;
    if (!node || !onViewportResize) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) onViewportResize({ width: box.width, height: box.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onViewportResize]);

  // ---- Wheel zoom, anchored on the pointer ----
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && Math.abs(event.deltaY) < 2) return;
      event.preventDefault();
      const factor = Math.exp(-event.deltaY / 400);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
      // Keep whatever is under the pointer under the pointer.
      const rect = node.getBoundingClientRect();
      const px = event.clientX - rect.left - rect.width / 2 - viewport.offsetX;
      const py = event.clientY - rect.top - rect.height / 2 - viewport.offsetY;
      const ratio = zoom / viewport.zoom;
      onViewportChange({
        zoom,
        offsetX: viewport.offsetX - px * (ratio - 1),
        offsetY: viewport.offsetY - py * (ratio - 1),
      });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [viewport, onViewportChange]);

  const displayWidth = Math.max(1, Math.round(state.width * viewport.zoom));
  const displayHeight = Math.max(1, Math.round(state.height * viewport.zoom));

  const onPointerDown = (event: React.PointerEvent) => {
    const point = toImage(event);
    // Middle button or space-style panning: always available, whatever the tool.
    if (event.button === 1 || mode === 'pan' || event.shiftKey) {
      panning.current = {
        x: event.clientX,
        y: event.clientY,
        offsetX: viewport.offsetX,
        offsetY: viewport.offsetY,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (!point) return;

    if (mode === 'eyedrop') {
      onPickColor?.(point.x, point.y);
      return;
    }
    if (mode === 'crop') {
      cropping.current = { x: point.x, y: point.y };
      event.currentTarget.setPointerCapture(event.pointerId);
      onCropDrag?.({ x: point.x, y: point.y, width: 0, height: 0 });
      return;
    }
    if (mode === 'brush') {
      // The right button (or Alt) restores instead of erasing — the standard
      // gesture, and far quicker than switching modes for a small correction.
      const erase = !(event.button === 2 || event.altKey);
      painting.current = { erase };
      event.currentTarget.setPointerCapture(event.pointerId);
      onStrokeStart?.(point.x, point.y, erase);
    }
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const point = toImage(event);
    if (point && mode === 'brush') {
      // Stored relative to the viewport, so rendering the cursor needs no ref.
      const box = event.currentTarget.getBoundingClientRect();
      setCursor({ x: event.clientX - box.left, y: event.clientY - box.top });
    }

    if (panning.current) {
      onViewportChange({
        zoom: viewport.zoom,
        offsetX: panning.current.offsetX + (event.clientX - panning.current.x),
        offsetY: panning.current.offsetY + (event.clientY - panning.current.y),
      });
      return;
    }
    if (cropping.current && point) {
      const start = cropping.current;
      onCropDrag?.({
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        width: Math.abs(point.x - start.x),
        height: Math.abs(point.y - start.y),
      });
      return;
    }
    if (painting.current && point) {
      onStrokeMove?.(point.x, point.y, painting.current.erase);
    }
  };

  const endInteraction = (event: React.PointerEvent) => {
    if (panning.current) {
      panning.current = undefined;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (cropping.current) {
      cropping.current = undefined;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (painting.current) {
      painting.current = undefined;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      onStrokeEnd?.();
    }
  };

  return (
    <div
      ref={viewportRef}
      className={cx(
        styles.viewport,
        mode === 'eyedrop' && styles.eyedropping,
        mode === 'pan' && styles.panning,
        mode === 'crop' && styles.eyedropping,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endInteraction}
      onPointerCancel={endInteraction}
      onPointerLeave={() => setCursor(undefined)}
      onContextMenu={(event) => {
        // The right button is the restore brush; a context menu would eat it.
        if (mode === 'brush') event.preventDefault();
      }}
    >
      <div
        className={cx(styles.canvasHolder, backdrop.kind === 'none' && 'checkerboard')}
        style={{
          width: displayWidth,
          height: displayHeight,
          transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px)`,
        }}
      >
        <canvas
          ref={backdropRef}
          className={styles.canvas}
          style={{ width: displayWidth, height: displayHeight, position: 'absolute', inset: 0 }}
          aria-hidden="true"
        />
        <canvas
          ref={canvasRef}
          className={cx(styles.canvas, viewport.zoom >= 4 && styles.pixelated)}
          style={{
            width: displayWidth,
            height: displayHeight,
            position: 'relative',
            filter,
          }}
        />
        {overlay}
      </div>

      {mode === 'brush' && cursor ? (
        <span
          className={styles.brushCursor}
          style={{
            left: cursor.x,
            top: cursor.y,
            width: brushSize * viewport.zoom,
            height: brushSize * viewport.zoom,
          }}
        />
      ) : null}
    </div>
  );
}

export { MIN_ZOOM, MAX_ZOOM };
