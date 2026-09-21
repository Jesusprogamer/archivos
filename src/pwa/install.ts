import { create } from 'zustand';
import { assetUrl } from '../core/util/assets';

/**
 * Instalación como aplicación y actualizaciones del service worker.
 *
 * El navegador no ofrece una API para preguntar «¿se puede instalar esto?».
 * Lo único que hay es un evento, `beforeinstallprompt`, que Chrome y Edge
 * disparan cuando el sitio cumple los requisitos, y que ni Safari ni Firefox
 * implementan. Por eso el estado se descubre escuchando, no consultando, y la
 * interfaz solo enseña el botón cuando el evento ha llegado de verdad: un
 * botón «Instalar» que no puede instalar nada es exactamente el tipo de
 * adorno que este proyecto no admite.
 */

/** No está en la librería estándar de TypeScript porque no es estándar. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type DisplayMode = 'browser' | 'installed';

/** Cómo se puede instalar en este navegador. */
export type InstallPath =
  /** Hay un evento guardado: basta con pulsar el botón. */
  | 'prompt'
  /** Safari en iPhone/iPad instala solo a mano, desde «Compartir». */
  | 'manual'
  /** Ni evento ni instrucciones fiables que dar. */
  | 'unavailable';

export interface PwaState {
  readonly mode: DisplayMode;
  readonly path: InstallPath;
  /** Hay una versión nueva descargada, esperando a que se acepte. */
  readonly updateReady: boolean;
  /** El armazón está en caché: la aplicación ya abre sin conexión. */
  readonly offlineReady: boolean;
}

/**
 * Detecta si la página ya se está viendo como aplicación instalada.
 *
 * `display-mode: standalone` cubre Android y escritorio; `navigator.standalone`
 * es lo que usa Safari en iOS, que no implementa la media query.
 */
export function detectDisplayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'browser';
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: minimal-ui)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true;
  return standalone ? 'installed' : 'browser';
}

/**
 * Safari en iOS y iPadOS sabe instalar, pero solo desde el menú Compartir.
 *
 * Se mira el motor, no el nombre: en iOS todos los navegadores son WebKit por
 * obligación, así que Chrome en un iPhone se comporta igual que Safari.
 */
export function isAppleTouchDevice(
  ua = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints,
): boolean {
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // Un iPad moderno se identifica como Mac; lo delata la pantalla táctil.
  return ua.includes('Macintosh') && touchPoints > 1;
}

interface Store extends PwaState {
  setState: (patch: Partial<PwaState>) => void;
}

const usePwaStore = create<Store>((set) => ({
  mode: detectDisplayMode(),
  path: 'unavailable',
  updateReady: false,
  offlineReady: false,
  setState: (patch) => set(patch),
}));

export const usePwa = usePwaStore;

let deferredPrompt: BeforeInstallPromptEvent | undefined;
let waiting: ServiceWorker | undefined;
/** Solo se recarga si la actualización la ha pedido el usuario. */
let updating = false;

/** Lanza el diálogo del navegador. Devuelve qué contestó el usuario. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferredPrompt) return 'unavailable';
  const event = deferredPrompt;
  // El evento solo sirve una vez: si se reutiliza, el navegador lo rechaza.
  deferredPrompt = undefined;
  usePwaStore.getState().setState({ path: 'unavailable' });
  await event.prompt();
  const { outcome } = await event.userChoice;
  if (outcome === 'dismissed') {
    // Se puede volver a intentar más tarde, así que se devuelve el evento.
    deferredPrompt = event;
    usePwaStore.getState().setState({ path: 'prompt' });
  }
  return outcome;
}

/** Activa la versión nueva y recarga. */
export function applyUpdate(): void {
  if (!waiting) {
    location.reload();
    return;
  }
  updating = true;
  waiting.postMessage({ type: 'FORJA_SKIP_WAITING' });
}

/**
 * Engancha los eventos del navegador. Se llama una vez, al arrancar.
 *
 * El service worker solo se registra en producción: en desarrollo interceptaría
 * las peticiones que Vite sirve en caliente y las recargas dejarían de reflejar
 * los cambios, que es una forma muy eficaz de perder una tarde.
 */
export function startPwa(): void {
  if (typeof window === 'undefined') return;
  const set = usePwaStore.getState().setState;

  window.addEventListener('beforeinstallprompt', (event) => {
    // Sin esto, Chrome enseña su propia barra y perdemos el control del momento.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    set({ path: 'prompt' });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = undefined;
    set({ path: 'unavailable', mode: 'installed' });
  });

  for (const query of ['(display-mode: standalone)', '(display-mode: minimal-ui)']) {
    window.matchMedia?.(query).addEventListener('change', () => set({ mode: detectDisplayMode() }));
  }

  if (deferredPrompt === undefined && isAppleTouchDevice() && detectDisplayMode() === 'browser') {
    set({ path: 'manual' });
  }

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  void navigator.serviceWorker
    .register(assetUrl('sw.js'), { scope: import.meta.env.BASE_URL })
    .then((registration) => {
      if (navigator.serviceWorker.controller) set({ offlineReady: true });

      const track = (worker: ServiceWorker | null) => {
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state !== 'installed') return;
          if (navigator.serviceWorker.controller) {
            // Había una versión anterior: esta es una actualización en espera.
            waiting = worker;
            set({ updateReady: true });
          } else {
            set({ offlineReady: true });
          }
        });
      };

      if (registration.waiting && navigator.serviceWorker.controller) {
        waiting = registration.waiting;
        set({ updateReady: true });
      }
      track(registration.installing);
      registration.addEventListener('updatefound', () => track(registration.installing));
    })
    .catch(() => {
      // Sin service worker la aplicación funciona igual, solo que sin modo sin
      // conexión. No es motivo para molestar a nadie con un error.
    });

  // `clients.claim()` dispara `controllerchange` también en la primera visita,
  // cuando no hay ninguna actualización que aplicar. Recargar ahí hacía que la
  // aplicación se reiniciara sola la primera vez que alguien la abría, que es
  // justo la impresión contraria a la que se busca. Solo se recarga cuando el
  // relevo lo ha pedido `applyUpdate()`.
  let reloading = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    if (!updating || reloading) return;
    reloading = true;
    location.reload();
  });
}
