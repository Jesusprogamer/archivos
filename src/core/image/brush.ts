import { type ByteArray } from './bytes';
/**
 * The manual eraser and restore brush.
 *
 * Brush work is the one editing operation that has to feel instant, so it is
 * deliberately local: a stroke only touches the pixels under it, and the
 * caller only repaints that rectangle.
 */

export interface BrushSettings {
  /** Diameter in image pixels. */
  readonly size: number;
  /** 0–100. 100 is a hard edge, 0 fades from the very centre. */
  readonly hardness: number;
  /** 0–100. How much of the effect a single stamp applies. */
  readonly opacity: number;
}

export type BrushMode = 'erase' | 'restore';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function emptyRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

export function unionRect(a: Rect, b: Rect): Rect {
  if (a.width === 0 || a.height === 0) return b;
  if (b.width === 0 || b.height === 0) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Falloff from the centre of the stamp.
 *
 * Hardness sets where the fade starts; beyond that it is a smoothstep, because
 * a linear fade leaves a visible ring at the boundary.
 */
function falloff(distance: number, radius: number, hardness: number): number {
  if (radius <= 0) return 0;
  const normalised = distance / radius;
  if (normalised >= 1) return 0;
  const solid = hardness / 100;
  if (normalised <= solid) return 1;
  const t = 1 - (normalised - solid) / (1 - solid);
  return t * t * (3 - 2 * t);
}

/**
 * Stamps the brush once, in place.
 *
 * Returns the rectangle touched so the caller can repaint only that region.
 */
export function stampBrush(
  mask: ByteArray,
  width: number,
  height: number,
  centerX: number,
  centerY: number,
  settings: BrushSettings,
  mode: BrushMode,
): Rect {
  // Floor the radius just above half a pixel diagonal (0.707). Without it a
  // one-pixel brush can land exactly on a pixel corner and paint nothing,
  // because every surrounding pixel centre is further away than the radius.
  const radius = Math.max(settings.size / 2, 0.75);
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius));
  if (maxX < minX || maxY < minY) return emptyRect();

  const strength = settings.opacity / 100;
  const target = mode === 'erase' ? 0 : 255;

  for (let y = minY; y <= maxY; y += 1) {
    const dy = y + 0.5 - centerY;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - centerX;
      const weight = falloff(Math.hypot(dx, dy), radius, settings.hardness) * strength;
      if (weight <= 0) continue;
      const index = y * width + x;
      const current = mask[index]!;
      mask[index] = current + (target - current) * weight;
    }
  }

  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/**
 * Stamps along a line, so a fast drag leaves a stroke rather than dots.
 *
 * The start point is excluded and the end point included: the previous stamp
 * already covered `from`, and stamping it twice would darken every joint of a
 * soft, low-opacity brush. The first stamp of a stroke is placed by the caller
 * on pointer down.
 *
 * The spacing of a quarter of the brush size is the usual compromise: closer
 * and a soft brush turns opaque under its own overlap, further apart and the
 * stroke visibly beads.
 */
export function strokeBrush(
  mask: ByteArray,
  width: number,
  height: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  settings: BrushSettings,
  mode: BrushMode,
): Rect {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const spacing = Math.max(1, settings.size / 4);
  const steps = Math.max(1, Math.ceil(distance / spacing));
  let dirty = emptyRect();

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    dirty = unionRect(
      dirty,
      stampBrush(
        mask,
        width,
        height,
        from.x + (to.x - from.x) * t,
        from.y + (to.y - from.y) * t,
        settings,
        mode,
      ),
    );
  }
  return dirty;
}
