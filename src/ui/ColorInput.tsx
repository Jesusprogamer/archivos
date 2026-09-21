import { useState } from 'react';
import { cx } from './cx';
import styles from './controls.module.css';

export interface ColorInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
  /** Hides the hex text box, leaving only the swatch. */
  swatchOnly?: boolean;
  disabled?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;

/**
 * A colour swatch with an editable hex field. The text box keeps its own draft
 * so half-typed values ("#ff7") do not fight the picker.
 */
export function ColorInput({
  id,
  value,
  onChange,
  label,
  swatchOnly = false,
  disabled = false,
}: ColorInputProps) {
  const [draft, setDraft] = useState(value);
  const [lastValue, setLastValue] = useState(value);

  // React's documented way to reset state when a prop changes: adjust during
  // render, not in an effect, so there is no extra commit to paint.
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  return (
    <span className={styles.colorRow}>
      <input
        id={id}
        className={styles.colorSwatch}
        type="color"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
      {swatchOnly ? null : (
        <input
          className={cx(styles.input, styles.colorText)}
          type="text"
          value={draft}
          disabled={disabled}
          spellCheck={false}
          aria-label={`${label} (hex)`}
          onChange={(event) => {
            setDraft(event.target.value);
            if (HEX.test(event.target.value)) onChange(event.target.value.toLowerCase());
          }}
          onBlur={() => setDraft(value)}
        />
      )}
    </span>
  );
}
