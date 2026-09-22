import { fontShorthand } from '../video/fonts';
import type { Canvas2D } from '../video/renderer';
import type { Frame } from './analysis';
import type { VisualizerScene, VisualSettings } from './scene';

/**
 * Drawing one visualiser frame.
 *
 * A pure function of (scene, frame, size): given the same analysis frame it
 * always paints the same picture. The particle style has no hidden state for
 * exactly that reason — its "particles" are derived from the frame index, not
 * simulated, so exporting twice gives identical video.
 */

export interface DrawAssets {
  readonly background?: CanvasImageSource | undefined;
  readonly logo?: CanvasImageSource | undefined;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Scales a pixel measurement given at 1080p to the current frame. */
function scaled(value: number, size: Size): number {
  return (value * size.height) / 1080;
}

function paintBackground(
  context: Canvas2D,
  scene: VisualizerScene,
  size: Size,
  assets: DrawAssets,
): void {
  const { background } = scene;
  context.save();

  if (background.kind === 'transparent') {
    // Vaciar, no pintar: cualquier relleno, aunque sea de color transparente,
    // dejaría el fotograma anterior debajo al dibujar encima.
    context.clearRect(0, 0, size.width, size.height);
    context.restore();
    return;
  }

  if (background.kind === 'image' && assets.background) {
    const image = assets.background;
    const imageWidth = 'width' in image ? Number(image.width) : size.width;
    const imageHeight = 'height' in image ? Number(image.height) : size.height;
    // Cover, so a background never stretches out of proportion.
    const scale = Math.max(size.width / imageWidth, size.height / imageHeight);
    const w = imageWidth * scale;
    const h = imageHeight * scale;
    context.drawImage(image, (size.width - w) / 2, (size.height - h) / 2, w, h);
  } else if (background.kind === 'gradient') {
    const radians = (background.gradientAngle * Math.PI) / 180;
    const half = Math.max(size.width, size.height) / 2;
    const gradient = context.createLinearGradient(
      size.width / 2 - Math.cos(radians) * half,
      size.height / 2 - Math.sin(radians) * half,
      size.width / 2 + Math.cos(radians) * half,
      size.height / 2 + Math.sin(radians) * half,
    );
    gradient.addColorStop(0, background.color);
    gradient.addColorStop(1, background.gradientTo);
    context.fillStyle = gradient;
    context.fillRect(0, 0, size.width, size.height);
  } else {
    context.fillStyle = background.color;
    context.fillRect(0, 0, size.width, size.height);
  }

  if (background.dim > 0) {
    context.fillStyle = `rgba(0, 0, 0, ${background.dim})`;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.restore();
}

/** A gradient across the visual, or a flat colour when that is what is wanted. */
function strokeStyle(context: Canvas2D, visual: VisualSettings, size: Size): string | CanvasGradient {
  if (!visual.gradientAcross) return visual.colorFrom;
  const gradient = context.createLinearGradient(0, 0, size.width, 0);
  gradient.addColorStop(0, visual.colorFrom);
  gradient.addColorStop(1, visual.colorTo);
  return gradient;
}

/**
 * The bands to draw, after sensitivity and mirroring.
 *
 * Mirroring folds the spectrum so the low frequencies meet in the middle, which
 * is what people mean by a symmetric visualiser — not simply reversing it.
 */
export function shapeBands(frame: Frame, visual: VisualSettings): Float32Array {
  const source = frame.bands;
  const amplified = new Float32Array(source.length);
  for (let i = 0; i < source.length; i += 1) {
    amplified[i] = Math.max(0, Math.min(1, source[i]! * visual.sensitivity));
  }
  if (!visual.symmetry) return amplified;

  const half = Math.ceil(amplified.length / 2);
  const mirrored = new Float32Array(amplified.length);
  for (let i = 0; i < half; i += 1) {
    const value = amplified[Math.floor((i * amplified.length) / half / 2)] ?? 0;
    mirrored[half - 1 - i] = value;
    if (half + i < mirrored.length) mirrored[half + i] = value;
  }
  return mirrored;
}

function applyGlow(context: Canvas2D, visual: VisualSettings, size: Size): void {
  if (visual.glow <= 0) {
    context.shadowBlur = 0;
    return;
  }
  context.shadowColor = visual.colorFrom;
  context.shadowBlur = scaled(40 * visual.glow, size);
}

function drawBars(
  context: Canvas2D,
  bands: Float32Array,
  visual: VisualSettings,
  size: Size,
  mirror: boolean,
): void {
  const count = Math.min(bands.length, visual.bars);
  const usable = size.width * 0.9;
  const slot = usable / count;
  const width = Math.max(1, slot * 0.68);
  const left = (size.width - usable) / 2 + (slot - width) / 2;
  const maxHeight = size.height * visual.height;
  const baseline = mirror ? size.height / 2 : size.height * 0.85;

  context.fillStyle = strokeStyle(context, visual, size);
  applyGlow(context, visual, size);

  for (let i = 0; i < count; i += 1) {
    const value = bands[Math.floor((i * bands.length) / count)] ?? 0;
    const height = Math.max(scaled(2, size), value * maxHeight * (mirror ? 0.5 : 1));
    const x = left + i * slot;
    if (mirror) {
      context.fillRect(x, baseline - height, width, height);
      context.fillRect(x, baseline, width, height);
    } else {
      context.fillRect(x, baseline - height, width, height);
    }
  }
  context.shadowBlur = 0;
}

function drawWaveLine(
  context: Canvas2D,
  frame: Frame,
  visual: VisualSettings,
  size: Size,
): void {
  const points = frame.wave;
  const middle = size.height / 2;
  const amplitude = size.height * visual.height * visual.sensitivity;

  context.strokeStyle = strokeStyle(context, visual, size);
  context.lineWidth = scaled(visual.thickness, size);
  context.lineJoin = 'round';
  context.lineCap = 'round';
  applyGlow(context, visual, size);

  context.beginPath();
  for (let i = 0; i < points.length; i += 1) {
    const x = (i / (points.length - 1)) * size.width;
    const y = middle + (points[i]! - 0.5) * amplitude;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
  context.shadowBlur = 0;
}

function drawRadial(
  context: Canvas2D,
  bands: Float32Array,
  visual: VisualSettings,
  size: Size,
  bass: number,
): void {
  const count = Math.min(bands.length, visual.bars);
  const centreX = size.width / 2;
  const centreY = size.height / 2;
  const base = Math.min(size.width, size.height) * 0.18 * (1 + bass * visual.bassReaction * 0.4);
  const reach = Math.min(size.width, size.height) * visual.height * 0.5;

  context.strokeStyle = strokeStyle(context, visual, size);
  context.lineWidth = scaled(visual.thickness, size);
  context.lineCap = 'round';
  applyGlow(context, visual, size);

  for (let i = 0; i < count; i += 1) {
    const value = bands[Math.floor((i * bands.length) / count)] ?? 0;
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const inner = base;
    const outer = base + Math.max(scaled(3, size), value * reach);
    context.beginPath();
    context.moveTo(centreX + Math.cos(angle) * inner, centreY + Math.sin(angle) * inner);
    context.lineTo(centreX + Math.cos(angle) * outer, centreY + Math.sin(angle) * outer);
    context.stroke();
  }

  context.beginPath();
  context.arc(centreX, centreY, base, 0, Math.PI * 2);
  context.stroke();
  context.shadowBlur = 0;
}

function drawArea(
  context: Canvas2D,
  bands: Float32Array,
  visual: VisualSettings,
  size: Size,
): void {
  const count = Math.min(bands.length, visual.bars);
  const baseline = size.height * 0.85;
  const maxHeight = size.height * visual.height;

  const gradient = context.createLinearGradient(0, baseline - maxHeight, 0, baseline);
  gradient.addColorStop(0, visual.colorTo);
  gradient.addColorStop(1, visual.colorFrom);

  context.beginPath();
  context.moveTo(0, baseline);
  for (let i = 0; i < count; i += 1) {
    const value = bands[Math.floor((i * bands.length) / count)] ?? 0;
    const x = (i / (count - 1)) * size.width;
    const y = baseline - value * maxHeight;
    if (i === 0) context.lineTo(x, y);
    else {
      // A smooth curve rather than straight segments: a spectrum drawn as a
      // polyline looks like a chart, not like music.
      const previousX = ((i - 1) / (count - 1)) * size.width;
      const previousValue = bands[Math.floor(((i - 1) * bands.length) / count)] ?? 0;
      const previousY = baseline - previousValue * maxHeight;
      const midX = (previousX + x) / 2;
      context.bezierCurveTo(midX, previousY, midX, y, x, y);
    }
  }
  context.lineTo(size.width, baseline);
  context.closePath();

  applyGlow(context, visual, size);
  context.fillStyle = gradient;
  context.fill();
  context.shadowBlur = 0;
}

/**
 * Particles derived from the frame, not simulated.
 *
 * Each particle's position comes from its index and the frame number through a
 * fixed formula, so the same moment always looks the same. A simulation with
 * carried-over state would make every export subtly different — and would drift
 * if a frame were ever recomputed.
 */
function drawParticles(
  context: Canvas2D,
  frame: Frame,
  frameIndex: number,
  visual: VisualSettings,
  size: Size,
): void {
  const count = Math.max(12, visual.bars * 2);
  const time = frameIndex / 30;
  const reach = Math.min(size.width, size.height) * visual.height;

  applyGlow(context, visual, size);

  for (let i = 0; i < count; i += 1) {
    const band = frame.bands[Math.floor((i * frame.bands.length) / count)] ?? 0;
    const energy = Math.min(1, band * visual.sensitivity);
    // A golden-angle spiral spreads the particles evenly without clumping.
    const angle = i * 2.399963 + time * 0.35;
    const radius = (0.15 + (i / count) * 0.85) * reach * (1 + energy * 0.6);
    const x = size.width / 2 + Math.cos(angle) * radius;
    const y = size.height / 2 + Math.sin(angle) * radius * 0.85;
    const size_ = scaled(visual.thickness, size) * (0.4 + energy * 1.6);

    context.globalAlpha = 0.25 + energy * 0.75;
    context.fillStyle = i % 2 === 0 ? visual.colorFrom : visual.colorTo;
    context.beginPath();
    context.arc(x, y, Math.max(0.6, size_), 0, Math.PI * 2);
    context.fill();
  }

  context.globalAlpha = 1;
  context.shadowBlur = 0;
}

function drawText(context: Canvas2D, scene: VisualizerScene, size: Size): void {
  const { text } = scene;
  if (!text.show || (text.title === '' && text.artist === '')) return;

  const titleSize = size.height * text.size;
  const artistSize = titleSize * 0.6;
  const gap = titleSize * 0.25;
  const total = (text.title ? titleSize : 0) + (text.artist ? artistSize + gap : 0);

  const y =
    text.position === 'top'
      ? size.height * 0.1 + total / 2
      : text.position === 'center'
        ? size.height / 2
        : size.height * 0.9 - total / 2;

  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = text.color;
  context.shadowColor = '#000000aa';
  context.shadowBlur = titleSize * 0.15;

  let cursor = y - total / 2;
  if (text.title) {
    context.font = fontShorthand(text.fontFamily, titleSize, true, false);
    context.fillText(text.title, size.width / 2, cursor + titleSize / 2);
    cursor += titleSize + gap;
  }
  if (text.artist) {
    context.font = fontShorthand(text.fontFamily, artistSize, false, false);
    context.globalAlpha = 0.85;
    context.fillText(text.artist, size.width / 2, cursor + artistSize / 2);
  }
  context.restore();
}

function drawLogo(
  context: Canvas2D,
  scene: VisualizerScene,
  size: Size,
  assets: DrawAssets,
): void {
  const { logo } = scene;
  if (!logo.show || !assets.logo) return;
  const image = assets.logo;
  const naturalWidth = 'width' in image ? Number(image.width) : 1;
  const naturalHeight = 'height' in image ? Number(image.height) : 1;
  const width = size.width * logo.size;
  const height = (naturalHeight / naturalWidth) * width;
  const margin = size.width * 0.04;

  const x =
    logo.position === 'center'
      ? (size.width - width) / 2
      : logo.position.endsWith('Right')
        ? size.width - width - margin
        : margin;
  const y =
    logo.position === 'center'
      ? (size.height - height) / 2
      : logo.position.startsWith('top')
        ? margin
        : size.height - height - margin;

  context.save();
  context.globalAlpha = logo.opacity;
  context.drawImage(image, x, y, width, height);
  context.restore();
}

/** Paints one complete visualiser frame. */
export function drawScene(
  context: Canvas2D,
  scene: VisualizerScene,
  frame: Frame | undefined,
  frameIndex: number,
  size: Size,
  assets: DrawAssets = {},
): void {
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  paintBackground(context, scene, size, assets);

  if (frame) {
    const { visual } = scene;
    const bands = shapeBands(frame, visual);
    // The bass pulse scales the whole visual about the centre.
    const pulse = 1 + frame.bass * visual.bassReaction * 0.18;

    context.save();
    context.translate(size.width / 2, size.height / 2);
    context.scale(pulse, pulse);
    context.translate(-size.width / 2, -size.height / 2);

    switch (visual.style) {
      case 'bars':
        drawBars(context, bands, visual, size, false);
        break;
      case 'mirrorBars':
        drawBars(context, bands, visual, size, true);
        break;
      case 'waveLine':
        drawWaveLine(context, frame, visual, size);
        break;
      case 'radial':
        drawRadial(context, bands, visual, size, frame.bass);
        break;
      case 'area':
        drawArea(context, bands, visual, size);
        break;
      case 'particles':
        drawParticles(context, frame, frameIndex, visual, size);
        break;
    }
    context.restore();
  }

  drawText(context, scene, size);
  drawLogo(context, scene, size, assets);
  context.restore();
}
