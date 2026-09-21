import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasmRuntimeAssets } from './scripts/vite-plugin-wasm-runtimes.ts';

/**
 * Cross-origin isolation headers.
 *
 * ffmpeg.wasm's multithreaded core needs `SharedArrayBuffer`, which browsers
 * only expose on cross-origin isolated pages. The app degrades to the
 * single-threaded core when these headers are missing (e.g. GitHub Pages),
 * so they are an optimisation, never a requirement.
 */
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

export default defineConfig({
  plugins: [react(), wasmRuntimeAssets()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    // The ffmpeg cores are emitted as plain assets by our plugin; keeping the
    // JS chunks small matters more than a single bundle here.
    chunkSizeWarningLimit: 1200,
  },
  optimizeDeps: {
    // These are loaded lazily as raw assets / workers, not pre-bundled.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', 'onnxruntime-web'],
  },
});
