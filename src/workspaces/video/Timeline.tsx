import { Eye, EyeOff, Lock, LockOpen, Volume2, VolumeX, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VideoEditor } from '../../core/video/editor';
import { clipEnd, isTextClip, type Clip, type Track } from '../../core/video/project';
import {
  pixelsToTime,
  snap,
  snapTargets,
  timeToPixels,
} from '../../core/video/timeline';
import { formatTimecode } from '../../core/util/format';
import { useT } from '../../i18n';
import { cx } from '../../ui/cx';
import styles from './Video.module.css';

const LANE_HEIGHT = 56;
const SNAP_PIXELS = 8;

type DragKind = 'move' | 'trimStart' | 'trimEnd';

interface Drag {
  readonly kind: DragKind;
  readonly clipId: string;
  readonly grabOffset: number;
  readonly originalTrackId: string;
}

export interface TimelineProps {
  editor: VideoEditor;
  zoom: number;
  /** Full source lengths, so a trim cannot run past the material. */
  sourceDurations: ReadonlyMap<string, number>;
  /** File names, so a clip is labelled with what it actually is. */
  sourceNames: ReadonlyMap<string, string>;
  onSeek: (time: number) => void;
}

function trackIcons(track: Track, editor: VideoEditor, labels: Record<string, string>) {
  const isAudio = track.kind === 'audio';
  return (
    <span className={styles.trackButtons}>
      <button
        type="button"
        className={styles.trackToggle}
        aria-pressed={track.locked}
        aria-label={labels['lock']}
        title={labels['lock']}
        onClick={() => editor.updateTrack(track.id, { locked: !track.locked })}
      >
        {track.locked ? <Lock size={12} aria-hidden="true" /> : <LockOpen size={12} aria-hidden="true" />}
      </button>
      {isAudio ? (
        <button
          type="button"
          className={styles.trackToggle}
          aria-pressed={track.muted}
          aria-label={labels['mute']}
          title={labels['mute']}
          onClick={() => editor.updateTrack(track.id, { muted: !track.muted })}
        >
          {track.muted ? <VolumeX size={12} aria-hidden="true" /> : <Volume2 size={12} aria-hidden="true" />}
        </button>
      ) : (
        <button
          type="button"
          className={styles.trackToggle}
          aria-pressed={track.hidden}
          aria-label={labels['hide']}
          title={labels['hide']}
          onClick={() => editor.updateTrack(track.id, { hidden: !track.hidden })}
        >
          {track.hidden ? <EyeOff size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
        </button>
      )}
      <button
        type="button"
        className={styles.trackToggle}
        aria-label={labels['remove']}
        title={labels['remove']}
        onClick={() => editor.removeTrack(track.id)}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </span>
  );
}

/**
 * The timeline.
 *
 * Clips are absolutely positioned divs rather than a canvas, so they can be
 * focused, labelled and dragged with the platform's own pointer capture — an
 * editor people can drive from the keyboard matters more here than shaving a
 * millisecond off a repaint.
 */
export function Timeline({ editor, zoom, sourceDurations, sourceNames, onSeek }: TimelineProps) {
  const t = useT();
  const project = editor.getProject();
  const lanesRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | undefined>(undefined);
  const [width, setWidth] = useState(0);

  const duration = Math.max(editor.duration, 10);
  const contentWidth = Math.max(width, timeToPixels(duration + 5, zoom));

  useEffect(() => {
    const node = lanesRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setWidth(Math.round(box.width));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // ---- Ruler ----
  useEffect(() => {
    const canvas = rulerRef.current;
    const node = lanesRef.current;
    if (!canvas || !node || contentWidth === 0) return;
    const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
    canvas.width = Math.round(contentWidth * dpr);
    canvas.height = Math.round(24 * dpr);
    canvas.style.width = `${contentWidth}px`;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, contentWidth, 24);

    const style = getComputedStyle(node);
    context.fillStyle = style.getPropertyValue('--fg-muted').trim() || '#6e7889';
    context.strokeStyle = style.getPropertyValue('--border').trim() || '#2b323c';
    context.font = '10px ui-monospace, monospace';
    context.textBaseline = 'middle';

    const perSecond = timeToPixels(1, zoom);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const step = steps.find((candidate) => candidate * perSecond >= 70) ?? 600;

    for (let time = 0; time * perSecond <= contentWidth; time += step) {
      const x = time * perSecond;
      context.beginPath();
      context.moveTo(x + 0.5, 16);
      context.lineTo(x + 0.5, 24);
      context.stroke();
      context.fillText(formatTimecode(time), x + 4, 9);
    }
  }, [contentWidth, zoom]);

  const timeAtPointer = useCallback(
    (clientX: number): number => {
      const node = lanesRef.current;
      if (!node) return 0;
      const box = node.getBoundingClientRect();
      return Math.max(0, pixelsToTime(clientX - box.left + node.scrollLeft, zoom));
    },
    [zoom],
  );

  // ---- Dragging clips ----
  const onClipPointerDown = (event: React.PointerEvent, clip: Clip, kind: DragKind) => {
    const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
    if (track?.locked) return;
    event.stopPropagation();
    editor.select(clip.id);
    drag.current = {
      kind,
      clipId: clip.id,
      grabOffset: timeAtPointer(event.clientX) - clip.start,
      originalTrackId: clip.trackId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current) return;
    const time = timeAtPointer(event.clientX);
    const tolerance = editor.snapping ? pixelsToTime(SNAP_PIXELS, zoom) : 0;
    const targets = snapTargets(project, editor.playhead, current.clipId);

    if (current.kind === 'move') {
      const raw = time - current.grabOffset;
      const start = Math.max(0, snap(raw, targets, tolerance));
      // Which lane the pointer is over decides the destination track.
      const lane = (event.target as HTMLElement).closest('[data-track-id]');
      const trackId = lane?.getAttribute('data-track-id') ?? current.originalTrackId;
      editor.moveClip(current.clipId, start, trackId);
      return;
    }

    const clip = project.tracks
      .flatMap((track) => track.clips)
      .find((candidate) => candidate.id === current.clipId);
    if (!clip) return;
    const edge = current.kind === 'trimStart' ? 'start' : 'end';
    const sourceDuration =
      'sourceId' in clip ? sourceDurations.get(clip.sourceId) : undefined;
    editor.trimClip(current.clipId, edge, snap(time, targets, tolerance), sourceDuration);
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = undefined;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const trackLabels = {
    lock: t('video.track.lock'),
    hide: t('video.track.hide'),
    mute: t('video.track.mute'),
    remove: t('video.removeTrack'),
  };

  return (
    <div className={styles.timelineBody}>
      <div className={styles.trackHeads}>
        <div className={styles.rulerSpacer} />
        {project.tracks.map((track) => (
          <div key={track.id} className={styles.trackHead}>
            <span className={styles.trackName}>{track.name}</span>
            {trackIcons(track, editor, trackLabels)}
          </div>
        ))}
      </div>

      <div
        ref={lanesRef}
        className={styles.lanes}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className={styles.ruler}
          style={{ width: contentWidth }}
          role="slider"
          tabIndex={0}
          aria-label={t('video.timeline')}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(editor.playhead)}
          onPointerDown={(event) => onSeek(timeAtPointer(event.clientX))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowRight') onSeek(editor.playhead + 1 / project.fps);
            if (event.key === 'ArrowLeft') onSeek(Math.max(0, editor.playhead - 1 / project.fps));
          }}
        >
          <canvas ref={rulerRef} className={styles.rulerCanvas} aria-hidden="true" />
        </div>

        {project.tracks.map((track) => (
          <div
            key={track.id}
            className={cx(styles.lane, track.locked && styles.laneLocked)}
            style={{ width: contentWidth, height: LANE_HEIGHT }}
            data-track-id={track.id}
          >
            {track.clips.map((clip) => {
              const left = timeToPixels(clip.start, zoom);
              const clipWidth = Math.max(4, timeToPixels(clip.duration, zoom));
              const selected = editor.selectedId === clip.id;
              const label = isTextClip(clip)
                ? clip.style.text.split('\n')[0]
                : (sourceNames.get(clip.sourceId) ?? clip.kind);

              return (
                <div
                  key={clip.id}
                  className={cx(
                    styles.clip,
                    clip.kind === 'audio' && styles.clipAudio,
                    clip.kind === 'text' && styles.clipText,
                    (clip.kind === 'video' || clip.kind === 'image') && styles.clipVideo,
                    selected && styles.clipSelected,
                  )}
                  style={{ left, width: clipWidth }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected}
                  aria-label={`${label} ${formatTimecode(clip.start)}–${formatTimecode(clipEnd(clip))}`}
                  onPointerDown={(event) => onClipPointerDown(event, clip, 'move')}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      editor.select(clip.id);
                    }
                  }}
                >
                  {clip.fadeIn > 0 ? (
                    <span
                      className={styles.clipFade}
                      style={{ width: timeToPixels(clip.fadeIn, zoom) }}
                    />
                  ) : null}
                  {clip.fadeOut > 0 ? (
                    <span
                      className={cx(styles.clipFade, styles.clipFadeOut)}
                      style={{ width: timeToPixels(clip.fadeOut, zoom), insetInlineEnd: 0 }}
                    />
                  ) : null}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
                  <span
                    className={cx(styles.clipHandle, styles.handleStart)}
                    onPointerDown={(event) => onClipPointerDown(event, clip, 'trimStart')}
                  />
                  <span
                    className={cx(styles.clipHandle, styles.handleEnd)}
                    onPointerDown={(event) => onClipPointerDown(event, clip, 'trimEnd')}
                  />
                </div>
              );
            })}
          </div>
        ))}

        <div
          className={styles.playhead}
          style={{ left: timeToPixels(editor.playhead, zoom), height: '100%' }}
        >
          <span className={styles.playheadKnob} />
        </div>
      </div>
    </div>
  );
}
