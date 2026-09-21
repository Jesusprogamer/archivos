import { fitSize, type CropRect } from '../../../core/image/transform';

/** The aspect ratios the crop tool offers. */
export const ASPECTS = [
  { id: 'free', ratio: 0 },
  { id: '1:1', ratio: 1 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '9:16', ratio: 9 / 16 },
  { id: '4:5', ratio: 4 / 5 },
] as const;

export type AspectId = (typeof ASPECTS)[number]['id'];

export function aspectRatio(id: AspectId): number {
  return ASPECTS.find((aspect) => aspect.id === id)?.ratio ?? 0;
}

/** Fits the largest rectangle of the given ratio inside the image, centred. */
export function centredRect(width: number, height: number, ratio: number): CropRect {
  if (ratio <= 0) return { x: 0, y: 0, width, height };
  const byWidth = fitSize(ratio, 1, { width });
  const rect = byWidth.height <= height ? byWidth : fitSize(ratio, 1, { height });
  return {
    x: Math.round((width - rect.width) / 2),
    y: Math.round((height - rect.height) / 2),
    width: rect.width,
    height: rect.height,
  };
}
