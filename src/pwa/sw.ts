/// <reference lib="webworker" />

/**
 * El service worker de Forja.
 *
 * Deliberadamente escrito a mano en lugar de con Workbox. Las necesidades de
 * esta aplicación son poco corrientes —hay 63 MB de núcleos de ffmpeg y 14 MB
 * de ONNX Runtime que **no** deben precargarse— y una caché mal planteada es
 * de los pocos fallos que pueden dejar una aplicación rota de forma permanente
 * para quien ya la instaló. Con tan poca lógica, prefiero poder leerla entera.
 *
 * Tres reglas que gobiernan todo lo de abajo:
 *
 * 1. Solo se guarda en caché lo que es inmutable por construcción: los ficheros
 *    del build llevan un hash en el nombre, así que nunca cambian de contenido.
 * 2. La navegación va primero a la red. Si un despliegue sale mal, la siguiente
 *    recarga se cura sola en vez de quedarse servida desde una caché podrida.
 * 3. Nunca se activa una versión nueva por sorpresa: la página tiene lazy
 *    imports, y cambiarle los ficheros por debajo a una sesión en marcha la
 *    rompería. La versión nueva espera a que el usuario acepte.
 *
 * Este fichero no se importa desde ninguna parte: lo compila y lo emite
 * `scripts/vite-plugin-pwa.ts`, que además le inyecta las constantes.
 */

declare const self: ServiceWorkerGlobalScope;

/** Nombre de la caché del armazón. Lleva el hash del build, así que cambia con él. */
declare const __SHELL_CACHE__: string;
/** Caché de los runtimes pesados. Lleva la versión del paquete, no la del build. */
declare const __RUNTIME_CACHE__: string;
/** Todo lo que se descarga por adelantado para poder funcionar sin conexión. */
declare const __PRECACHE__: readonly string[];
/** La página, que es también el recurso al que cae cualquier navegación. */
declare const __SHELL__: string;

const KEEP = new Set([__SHELL_CACHE__, __RUNTIME_CACHE__]);

/**
 * `ignoreVary` no es opcional aquí, aunque lo parezca.
 *
 * Muchos servidores (entre ellos `vite preview`, Netlify y Cloudflare) mandan
 * `Vary: Origin`. Vite marca sus scripts y hojas de estilo con `crossorigin`,
 * así que el navegador los pide en modo `cors` y añade la cabecera `Origin`,
 * cosa que no hacía la petición con la que se guardaron. Con `Vary` en juego,
 * eso basta para que la caché los dé por distintos: la aplicación quedaba sin
 * conexión con el armazón guardado y sin poder usarlo, que es el peor de los
 * dos mundos. Todo lo que hay aquí es del mismo origen y lleva el hash del
 * contenido en el nombre, así que `Vary` no aporta nada que proteger.
 */
const MATCH: CacheQueryOptions = { ignoreVary: true };

/**
 * Lo que se guarda solo cuando alguien lo pide: los núcleos de ffmpeg y el
 * runtime de ONNX. Juntos pesan más que todo lo demás multiplicado por
 * cincuenta, y la mayoría de las sesiones no llegan a tocarlos.
 */
function isHeavyRuntime(pathname: string): boolean {
  return pathname.includes('/ffmpeg/') || pathname.endsWith('.wasm') || pathname.endsWith('.mjs');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(__SHELL_CACHE__).then((cache) =>
      // `reload` evita que la caché HTTP del navegador cuele una copia vieja
      // dentro de la caché nueva, que es un error difícil de ver y de arreglar.
      cache.addAll(__PRECACHE__.map((url) => new Request(url, { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((name) => name.startsWith('forja-') && !KEEP.has(name))
          .map((name) => caches.delete(name)),
      );
      await self.clients.claim();
    })(),
  );
});

/** La página pide el relevo cuando el usuario acepta actualizar. */
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'FORJA_SKIP_WAITING') {
    void self.skipWaiting();
  }
});

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(__SHELL_CACHE__);
      await cache.put(__SHELL__, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(__SHELL__, MATCH);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;

  const response = await fetch(request);
  // Una respuesta opaca (`type: 'opaque'`) tiene status 0 y no se puede
  // inspeccionar: guardarla es cómo se acaba sirviendo un error para siempre.
  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Las peticiones por rangos son de <video>/<audio> reproduciendo; la caché
  // no sabe responder un 206 y romperíamos la reproducción.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isHeavyRuntime(url.pathname)) {
    event.respondWith(cacheFirst(request, __RUNTIME_CACHE__));
    return;
  }

  event.respondWith(caches.match(request, MATCH).then((cached) => cached ?? fetch(request)));
});
