import { defineConfig } from 'vite';
import { wasmRuntimeAssets } from '../scripts/vite-plugin-wasm-runtimes.ts';

export default defineConfig({
  root: import.meta.dirname,
  publicDir: '../public',
  plugins: [wasmRuntimeAssets()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
