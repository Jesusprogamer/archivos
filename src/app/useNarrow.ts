import { useSyncExternalStore } from 'react';

/**
 * El mismo punto de ruptura que usa el CSS para pasar a diseño de móvil.
 *
 * Está aquí y no en un `.css` porque hay decisiones que no son de estilo sino
 * de comportamiento: en una pantalla estrecha la biblioteca es un cajón que
 * tapa el editor, así que tiene que empezar cerrada y cerrarse al elegir un
 * archivo. Eso no se puede expresar con una media query.
 */
export const NARROW_QUERY = '(max-width: 860px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const media = window.matchMedia(NARROW_QUERY);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function snapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(NARROW_QUERY).matches;
}

/** True en pantallas de móvil. Se actualiza al girar el dispositivo. */
export function useNarrow(): boolean {
  // El tercer argumento es el valor en servidor; aquí no hay, pero
  // `useSyncExternalStore` lo exige para no romper en un render sin `window`.
  return useSyncExternalStore(subscribe, snapshot, () => false);
}
