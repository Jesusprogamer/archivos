import { fontShorthand } from './fonts';
import {
  clipEnd,
  fadeFactorAt,
  isTextClip,
  sampleProperty,
  sourceTimeAt,
  type Clip,
  type MediaClip,
  type TextAnimation,
  type TextClip,
  type VideoProject,
} from './project';

/**
 * The compositor.
 *
 * One pure function draws one frame. The preview calls it sixty times a second
 * and the exporter calls it once per output frame, from the same project object
 * — which is the only way to guarantee that what was previewed is what gets
 * written. Nothing in this file touches React, and nothing in it knows whether
 * it is drawing to a visible canvas or to an offscreen one.
 */

/**
 * Either canvas flavour will do.
 *
 * The preview draws to a visible `CanvasRenderingContext2D` and the exporter to
 * an `OffscreenCanvasRenderingContext2D`. They differ only in two methods this
 * file never calls, so naming the union keeps one renderer for both.
 */
export type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Whatever a clip draws from: a video element, a bitmap, or nothing yet. */
export interface RenderSource {
  readonly kind: 'video' | 'image';
  readonly element: CanvasImageSource;
  readonly width: number;
  readonly height: number;
}

export type SourceLookup = (sourceId: string) => RenderSource | undefined;

export interface RenderOptions {
  /** Draw at a fraction of project size, for a cheaper live preview. */
  readonly scale?: number;
}

/** How a source is placed inside the project frame. */
export interface Placement {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Fits a source inside the frame, preserving its aspect ratio.
 *
 * "Contain" rather than "cover": cropping someone's footage without being asked
 * is worse than letting bars show, and the scale control is right there when
 * they want it filled.
 */
export function fitContain(
  sourceWidth: number,
  sourceHeight: number,
  frameWidth: number,
  frameHeight: number,
): Placement {
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { x: 0, y: 0, width: frameWidth, height: frameHeight };
  }
  const scale = Math.min(frameWidth / sourceWidth, frameHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { x: (frameWidth - width) / 2, y: (frameHeight - height) / 2, width, height };
}

/** The 0–1 progress of a transition at a moment, or `undefined` if not in one. */
export function transitionProgress(clip: Clip, time: number): number | undefined {
  const { kind, duration } = clip.transition;
  if (kind === 'none' || duration <= 0) return undefined;
  const local = time - clip.start;
  if (local < 0 || local >= duration) return undefined;
  return local / duration;
}

/** The extra opacity an animated text clip has at a moment. */
export function textAnimationAt(
  clip: TextClip,
  time: number,
): { opacity: number; offsetX: number; offsetY: number; scale: number } {
  const local = time - clip.start;
  const duration = Math.min(0.4, clip.duration / 3);
  const entering = local < duration ? local / duration : 1;
  const leaving = local > clip.duration - duration ? (clip.duration - local) / duration : 1;

  const apply = (animation: TextAnimation, progress: number, sign: number) => {
    const eased = progress * progress * (3 - 2 * progress);
    switch (animation) {
      case 'fade':
        return { opacity: eased, offsetX: 0, offsetY: 0, scale: 1 };
      case 'slideUp':
        return { opacity: eased, offsetX: 0, offsetY: sign * (1 - eased) * 60, scale: 1 };
      case 'slideLeft':
        return { opacity: eased, offsetX: sign * (1 - eased) * 80, offsetY: 0, scale: 1 };
      case 'zoom':
        return { opacity: eased, offsetX: 0, offsetY: 0, scale: 0.8 + eased * 0.2 };
      default:
        return { opacity: 1, offsetX: 0, offsetY: 0, scale: 1 };
    }
  };

  const inPart = apply(clip.style.animateIn, Math.max(0, Math.min(1, entering)), 1);
  const outPart = apply(clip.style.animateOut, Math.max(0, Math.min(1, leaving)), -1);

  return {
    opacity: inPart.opacity * outPart.opacity,
    offsetX: inPart.offsetX + outPart.offsetX,
    offsetY: inPart.offsetY + outPart.offsetY,
    scale: inPart.scale * outPart.scale,
  };
}

/**
 * The opacity a clip contributes, before it is drawn.
 *
 * Exported so the exporter and the tests can reason about a crossfade without
 * rendering: during a crossfade the incoming clip ramps up while the outgoing
 * one, which overlaps it on the timeline, keeps playing underneath.
 */
export function clipOpacityAt(clip: Clip, time: number): number {
  const base = sampleProperty(clip, 'opacity', time, clip.transform.opacity);
  const fade = fadeFactorAt(clip, time);
  const progress = transitionProgress(clip, time);
  const crossfade = progress !== undefined && clip.transition.kind === 'crossfade' ? progress : 1;
  return base * fade * crossfade;
}

function colorFilter(clip: MediaClip): string {
  const { brightness, contrast, saturation } = clip.color;
  if (brightness === 100 && contrast === 100 && saturation === 100) return 'none';
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
}

function drawMediaClip(
  context: Canvas2D,
  clip: MediaClip,
  source: RenderSource,
  time: number,
  frameWidth: number,
  frameHeight: number,
): void {
  const opacity = clipOpacityAt(clip, time);
  if (opacity <= 0.001) return;

  const crop = clip.transform.crop;
  const sourceX = source.width * crop.left;
  const sourceY = source.height * crop.top;
  const sourceWidth = source.width * (1 - crop.left - crop.right);
  const sourceHeight = source.height * (1 - crop.top - crop.bottom);
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const placement = fitContain(sourceWidth, sourceHeight, frameWidth, frameHeight);
  const scale = sampleProperty(clip, 'scale', time, clip.transform.scale);
  const offsetX = sampleProperty(clip, 'x', time, clip.transform.x);
  const offsetY = sampleProperty(clip, 'y', time, clip.transform.y);

  context.save();
  context.globalAlpha = opacity;
  context.filter = colorFilter(clip);
  // Rotate and scale about the frame centre plus the clip's offset, so moving
  // a clip does not change where it spins.
  context.translate(frameWidth / 2 + offsetX, frameHeight / 2 + offsetY);
  if (clip.transform.rotation !== 0) {
    context.rotate((clip.transform.rotation * Math.PI) / 180);
  }
  context.scale(scale, scale);
  context.drawImage(
    source.element,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    placement.x - frameWidth / 2,
    placement.y - frameHeight / 2,
    placement.width,
    placement.height,
  );
  context.restore();
}

/** Wraps text to the frame width, honouring explicit line breaks. */
export function wrapText(
  context: Canvas2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`;
      if (context.measureText(candidate).width <= maxWidth || line === '') {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

function drawTextClip(
  context: Canvas2D,
  clip: TextClip,
  time: number,
  frameWidth: number,
  frameHeight: number,
): void {
  const style = clip.style;
  const animation = textAnimationAt(clip, time);
  const opacity = clipOpacityAt(clip, time) * animation.opacity;
  if (opacity <= 0.001 || style.text === '') return;

  const scale = sampleProperty(clip, 'scale', time, clip.transform.scale) * animation.scale;
  const x = sampleProperty(clip, 'x', time, clip.transform.x) + animation.offsetX;
  const y = sampleProperty(clip, 'y', time, clip.transform.y) + animation.offsetY;

  context.save();
  context.globalAlpha = opacity;
  context.translate(frameWidth / 2 + x, frameHeight / 2 + y);
  context.scale(scale, scale);
  if (clip.transform.rotation !== 0) {
    context.rotate((clip.transform.rotation * Math.PI) / 180);
  }

  context.font = fontShorthand(style.fontFamily, style.fontSize, style.bold, style.italic);
  context.textAlign = style.align;
  context.textBaseline = 'middle';

  const maxWidth = frameWidth * 0.86;
  const lines = wrapText(context, style.text, maxWidth);
  const lineHeight = style.fontSize * 1.2;
  const blockHeight = lines.length * lineHeight;
  const anchorX = style.align === 'left' ? -maxWidth / 2 : style.align === 'right' ? maxWidth / 2 : 0;

  if (style.backgroundOpacity > 0) {
    const widest = lines.reduce(
      (longest, line) => Math.max(longest, context.measureText(line).width),
      0,
    );
    const padding = style.fontSize * 0.3;
    context.save();
    context.globalAlpha = opacity * style.backgroundOpacity;
    context.fillStyle = style.backgroundColor;
    const boxX =
      style.align === 'left' ? anchorX : style.align === 'right' ? anchorX - widest : -widest / 2;
    context.fillRect(
      boxX - padding,
      -blockHeight / 2 - padding,
      widest + padding * 2,
      blockHeight + padding * 2,
    );
    context.restore();
  }

  if (style.shadow) {
    context.shadowColor = '#00000099';
    context.shadowBlur = style.fontSize * 0.12;
    context.shadowOffsetY = style.fontSize * 0.05;
  }

  lines.forEach((line, index) => {
    const lineY = -blockHeight / 2 + lineHeight * (index + 0.5);
    if (style.outlineWidth > 0) {
      context.lineWidth = style.outlineWidth;
      context.strokeStyle = style.outlineColor;
      context.lineJoin = 'round';
      context.miterLimit = 2;
      context.strokeText(line, anchorX, lineY);
    }
    context.fillStyle = style.color;
    context.fillText(line, anchorX, lineY);
  });

  context.restore();
}

/**
 * Draws one frame of the project.
 *
 * Tracks are painted from the bottom of the list upwards, so the track at the
 * top of the timeline UI is the one on top of the picture — the convention
 * every editor uses.
 */
export function renderFrame(
  context: Canvas2D,
  project: VideoProject,
  time: number,
  lookup: SourceLookup,
  options: RenderOptions = {},
): void {
  const scale = options.scale ?? 1;
  const width = project.width * scale;
  const height = project.height * scale;

  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = project.backgroundColor;
  context.fillRect(0, 0, width, height);
  context.scale(scale, scale);

  const visual = project.tracks.filter((track) => track.kind !== 'audio' && !track.hidden);

  for (const track of [...visual].reverse()) {
    for (const clip of track.clips) {
      if (time < clip.start || time >= clipEnd(clip)) continue;

      if (isTextClip(clip)) {
        drawTextClip(context, clip, time, project.width, project.height);
        continue;
      }

      const source = lookup(clip.sourceId);
      if (!source) continue;
      drawMediaClip(context, clip, source, time, project.width, project.height);

      // A fade-to-black transition dips the whole frame at its midpoint, so it
      // is painted over everything drawn so far.
      const progress = transitionProgress(clip, time);
      if (progress !== undefined && clip.transition.kind === 'fadeToBlack') {
        context.save();
        context.globalAlpha = 1 - Math.abs(progress * 2 - 1);
        context.fillStyle = '#000000';
        context.fillRect(0, 0, project.width, project.height);
        context.restore();
      }
    }
  }

  context.restore();
}


export { sourceTimeAt };
