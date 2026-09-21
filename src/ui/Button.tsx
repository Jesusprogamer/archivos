import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import styles from './Button.module.css';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
  /** Renders a square button; `aria-label` becomes mandatory in practice. */
  iconOnly?: boolean;
  /** Toggle buttons use this instead of a variant switch. */
  pressed?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  block = false,
  iconOnly = false,
  pressed,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        styles.button,
        styles[variant],
        styles[size],
        block && styles.block,
        iconOnly && styles.iconOnly,
        pressed && styles.pressed,
        className,
      )}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      {...rest}
    />
  );
}
