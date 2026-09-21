import { cx } from '../ui/cx';
import styles from './Wordmark.module.css';

/**
 * The mark is an anvil-and-spark "A" drawn from the same two strokes as the
 * favicon, so the product reads the same in a tab and in the top bar.
 */
export function Wordmark({ size = 20, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <span className={cx(styles.wordmark)}>
      <svg
        className={styles.glyph}
        width={size}
        height={size}
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M10 22 L16 7 L22 22"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M12.5 17 H19.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {showText ? <span className={styles.text}>Forja</span> : null}
    </span>
  );
}
