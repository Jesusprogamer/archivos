import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { durationOf, frameAt, type AudioData, type Selection } from '../../core/audio/buffer';
import { PeakCache } from '../../core/audio/waveform';
import { formatTimecode } from '../../core/util/format';
import styles from './Audio.module.css';

export interface WaveformView {
  /** Visible window, in seconds. */
  readonly start: number;
  readonly end: number;
}

export interface WaveformProps {
  audio: AudioData;
  /** Bumped when the samples change, so peaks are recomputed only then. */
  revision: number;
  view: WaveformView;
  selection: Selection | undefined;
  playhead: number;
  onSelectionChange: (selection: Selection | undefined) => void;
  onPlayheadChange: (seconds: number) => void;
  onViewChange: (view: WaveformView) => void;
}

const CHANNEL_GAP = 6;

/** Reads a CSS custom property so the canvas matches the active theme. */
function cssColor(element: HTMLElement, name: string, fallback: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim() || fallback;
}

/**
 * The waveform.
 *
 * Drawn on a canvas rather than in SVG: at a few thousand columns per channel,
 * SVG elements would swamp the DOM, and a canvas redraw is a couple of
 * milliseconds. Peaks come from a cache keyed on the view and the sample
 * revision, so dragging a selection or moving the playhead never recomputes
 * them.
 */
export function Waveform({
  audio,
  revision,
  view,
  selection,
  playhead,
  onSelectionChange,
  onPlayheadChange,
  onViewChange,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timelineRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const cache = useMemo(() => new PeakCache(), []);
  const dragging = useRef<{ anchor: number } | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const duration = durationOf(audio);
  const span = Math.max(1e-6, view.end - view.start);

  // ---- Size ----
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setSize({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const timeToX = useCallback(
    (seconds: number) => ((seconds - view.start) / span) * size.width,
    [view.start, span, size.width],
  );

  const xToTime = useCallback(
    (x: number) => view.start + (x / Math.max(1, size.width)) * span,
    [view.start, span, size.width],
  );

  // ---- Waveform painting ----
  useEffect(() => {
    const canvas = canvasRef.current;
    const area = areaRef.current;
    if (!canvas || !area || size.width === 0) return;

    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.max(1, Math.round(size.height * dpr));
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);

    const background = cssColor(area, '--bg-canvas', '#0a0c0f');
    const waveColor = cssColor(area, '--accent', '#ff7a2f');
    const axisColor = cssColor(area, '--border', '#2b323c');
    const selectionColor = cssColor(area, '--accent-soft', '#ff7a2f24');
    const playheadColor = cssColor(area, '--fg', '#e9edf3');

    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);

    const peaks = cache.get(
      audio,
      frameAt(audio, view.start),
      frameAt(audio, view.end),
      size.width,
      revision,
    );
    const channels = peaks.length || 1;
    const laneHeight = (size.height - CHANNEL_GAP * (channels - 1)) / channels;

    peaks.forEach((columns, channelIndex) => {
      const top = channelIndex * (laneHeight + CHANNEL_GAP);
      const middle = top + laneHeight / 2;
      const scale = laneHeight / 2;

      context.strokeStyle = axisColor;
      context.beginPath();
      context.moveTo(0, middle);
      context.lineTo(size.width, middle);
      context.stroke();

      context.fillStyle = waveColor;
      for (let x = 0; x < columns.length; x += 1) {
        const column = columns[x]!;
        const high = middle - column.max * scale;
        const low = middle - column.min * scale;
        // A minimum of one pixel keeps quiet passages visible as a thin line
        // rather than disappearing entirely.
        context.fillRect(x, high, 1, Math.max(1, low - high));
      }
    });

    if (selection && selection.end > selection.start) {
      const x1 = timeToX(selection.start);
      const x2 = timeToX(selection.end);
      context.fillStyle = selectionColor;
      context.fillRect(x1, 0, x2 - x1, size.height);
      context.strokeStyle = waveColor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(x1 + 0.5, 0);
      context.lineTo(x1 + 0.5, size.height);
      context.moveTo(x2 - 0.5, 0);
      context.lineTo(x2 - 0.5, size.height);
      context.stroke();
    }

    const playheadX = timeToX(playhead);
    if (playheadX >= 0 && playheadX <= size.width) {
      context.strokeStyle = playheadColor;
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(playheadX + 0.5, 0);
      context.lineTo(playheadX + 0.5, size.height);
      context.stroke();
    }
  }, [audio, revision, view, selection, playhead, size, cache, timeToX]);

  // ---- Ruler ----
  useEffect(() => {
    const canvas = timelineRef.current;
    const area = areaRef.current;
    if (!canvas || !area || size.width === 0) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(size.width * dpr));
    canvas.height = Math.round(22 * dpr);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, 22);

    context.fillStyle = cssColor(area, '--fg-muted', '#6e7889');
    context.strokeStyle = cssColor(area, '--border', '#2b323c');
    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'middle';

    // A tick roughly every 90 px, snapped to a readable interval.
    const target = (span / size.width) * 90;
    const steps = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((candidate) => candidate >= target) ?? 900;

    for (let time = Math.ceil(view.start / step) * step; time <= view.end; time += step) {
      const x = timeToX(time);
      context.beginPath();
      context.moveTo(x + 0.5, 14);
      context.lineTo(x + 0.5, 22);
      context.stroke();
      context.fillText(formatTimecode(time), x + 4, 8);
    }
  }, [view, span, size.width, timeToX, view.start, view.end]);

  // ---- Wheel: zoom with a modifier, scroll without ----
  useEffect(() => {
    const node = areaRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const anchor = xToTime(event.clientX - node.getBoundingClientRect().left);
        const factor = Math.exp(event.deltaY / 300);
        const newSpan = Math.max(0.01, Math.min(duration, span * factor));
        const ratio = (anchor - view.start) / span;
        const start = Math.max(0, Math.min(duration - newSpan, anchor - ratio * newSpan));
        onViewChange({ start, end: start + newSpan });
      } else {
        const delta = (event.deltaX || event.deltaY) * (span / Math.max(1, size.width));
        const start = Math.max(0, Math.min(duration - span, view.start + delta));
        onViewChange({ start, end: start + span });
      }
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [duration, span, view.start, size.width, xToTime, onViewChange]);

  const onPointerDown = (event: React.PointerEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, Math.min(duration, xToTime(event.clientX - box.left)));
    dragging.current = { anchor: time };
    event.currentTarget.setPointerCapture(event.pointerId);
    onPlayheadChange(time);
    onSelectionChange(undefined);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!dragging.current) return;
    const box = event.currentTarget.getBoundingClientRect();
    const time = Math.max(0, Math.min(duration, xToTime(event.clientX - box.left)));
    const { anchor } = dragging.current;
    // A drag of less than a pixel is a click, not a selection.
    if (Math.abs(timeToX(time) - timeToX(anchor)) < 2) {
      onSelectionChange(undefined);
      return;
    }
    onSelectionChange({ start: Math.min(anchor, time), end: Math.max(anchor, time) });
  };

  const endDrag = (event: React.PointerEvent) => {
    dragging.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <>
      <div className={styles.timeline}>
        <canvas ref={timelineRef} className={styles.timelineCanvas} aria-hidden="true" />
      </div>
      <div
        ref={areaRef}
        className={styles.waveArea}
        role="application"
        aria-label={formatTimecode(duration)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <canvas ref={canvasRef} className={styles.waveCanvas} />
      </div>
    </>
  );
}
