/**
 * Cuántos hilos se le piden a libx264.
 *
 * No es una optimización opcional: **sin `-threads` explícito, libx264 se cae**
 * contra el núcleo multihilo de ffmpeg.wasm, que es el que se usa siempre que
 * la página está aislada. Medido en el spike 8 (PLAN §3.8):
 *
 * | `-threads`      | libx264            |
 * | --------------- | ------------------ |
 * | sin especificar | se cae tras el 1.º |
 * | 1               | 2,1 s              |
 * | 2               | 1,3 s              |
 * | 4               | 1,3 s              |
 *
 * La explicación que encaja con lo medido: ffmpeg deduce el número de hilos de
 * los núcleos de la máquina y pide más de los que tiene el grupo de hilos con
 * el que se compiló el núcleo wasm. Un tope bajo cabe siempre.
 *
 * Los tres recuentos producen **bytes idénticos**, así que subirlo no cambia
 * nada de la imagen: es velocidad gratis, no un compromiso de calidad.
 *
 * libx265 y libvpx no lo necesitan: van bien sin tocar nada, y a libx265 le
 * sienta peor (`-threads 1` lo dejó en 4,7 s frente a 3,8 s sin especificar).
 */
export function x264Threads(): number {
  const cores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency > 0
      ? navigator.hardwareConcurrency
      : 2;
  // Más de cuatro no aportó nada medible y se acerca al límite del grupo.
  return Math.max(1, Math.min(4, cores));
}

/** Los argumentos listos para concatenar. */
export function x264ThreadArgs(): string[] {
  return ['-threads', String(x264Threads())];
}
