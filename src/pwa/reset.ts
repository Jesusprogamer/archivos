/**
 * Borrado de todo el rastro local.
 *
 * Este módulo no importa nada a propósito. Lo usa la pantalla de error, que
 * tiene que poder ejecutarse cuando lo demás ha fallado: cualquier importación
 * suya sería una candidata más a ser justo lo que está roto.
 *
 * Es la salida para el caso en que una versión guardada en caché deje la
 * aplicación inservible, que es el único fallo capaz de sobrevivir a una
 * recarga.
 */
export async function clearInstalledData(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker?.getRegistrations?.();
    await Promise.all((registrations ?? []).map((registration) => registration.unregister()));
  } catch {
    // Sin service worker que dar de baja: nada que hacer.
  }
  try {
    const names = await caches.keys();
    await Promise.all(names.map((name) => caches.delete(name)));
  } catch {
    // La Cache API no está disponible (modo privado en algunos navegadores).
  }
  try {
    localStorage.clear();
  } catch {
    // Almacenamiento bloqueado.
  }
  try {
    const databases = await indexedDB.databases?.();
    for (const database of databases ?? []) {
      if (database.name) indexedDB.deleteDatabase(database.name);
    }
  } catch {
    // Firefox anterior a la 126 no tiene databases(); con recargar basta.
  }
}
