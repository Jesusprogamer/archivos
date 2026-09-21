import type { CropRect } from '../../../core/image/transform';
import styles from '../Image.module.css';

/**
 * The crop frame, drawn over the picture.
 *
 * Positions are percentages of the image, so the frame follows zoom and pan
 * without any measurement: the holder it sits in is already the right size.
 */
export function CropOverlay({
  rect,
  imageWidth,
  imageHeight,
}: {
  rect: CropRect;
  imageWidth: number;
  imageHeight: number;
}) {
  if (rect.width < 1 || rect.height < 1) return null;
  const left = (rect.x / imageWidth) * 100;
  const top = (rect.y / imageHeight) * 100;
  const width = (rect.width / imageWidth) * 100;
  const height = (rect.height / imageHeight) * 100;

  return (
    <div className={styles.cropOverlay} style={{ pointerEvents: 'none' }} aria-hidden="true">
      {/* Four shades rather than one box-shadow: this keeps the dimmed area
          crisp at any zoom, where a huge spread shadow blurs. */}
      <div className={styles.cropShade} style={{ left: 0, top: 0, width: '100%', height: `${top}%` }} />
      <div
        className={styles.cropShade}
        style={{ left: 0, top: `${top + height}%`, width: '100%', bottom: 0 }}
      />
      <div className={styles.cropShade} style={{ left: 0, top: `${top}%`, width: `${left}%`, height: `${height}%` }} />
      <div
        className={styles.cropShade}
        style={{ left: `${left + width}%`, top: `${top}%`, right: 0, height: `${height}%` }}
      />
      <div
        className={styles.cropFrame}
        style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
      >
        <div className={styles.cropThirds} />
      </div>
    </div>
  );
}
