/**
 * Abrir archivos desde el sistema operativo.
 *
 * Cuando Forja está instalada, el manifiesto la declara como aplicación capaz
 * de abrir imágenes, audio y vídeo, así que puede aparecer en «Abrir con». El
 * sistema entrega entonces los archivos por `launchQueue`.
 *
 * Solo lo implementan Chrome y Edge de escritorio. Donde no existe, esto no
 * hace nada y la entrada del manifiesto se ignora: nadie ve una función a
 * medias, simplemente no se ofrece.
 */

interface LaunchParams {
  readonly files: readonly FileSystemFileHandle[];
}

interface LaunchQueue {
  setConsumer: (consumer: (params: LaunchParams) => void) => void;
}

/**
 * Registra el consumidor. Devuelve `false` si el navegador no lo soporta, para
 * que quien llame pueda decirlo en lugar de suponerlo.
 */
export function startLaunchQueue(onFiles: (files: File[]) => void): boolean {
  const queue = (globalThis as { launchQueue?: LaunchQueue }).launchQueue;
  if (!queue) return false;

  queue.setConsumer((params) => {
    if (params.files.length === 0) return;
    void Promise.all(params.files.map((handle) => handle.getFile()))
      .then((files) => onFiles(files))
      .catch(() => {
        // Un permiso revocado entre el clic y la apertura. El usuario puede
        // soltar el archivo en la ventana como siempre.
      });
  });
  return true;
}
