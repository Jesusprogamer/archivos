import { defineConfig } from 'vite';
import { ffmpegCoreAssets } from '../scripts/vite-plugin-ffmpeg-core.ts';

export default defineConfig({
  root: import.meta.dirname,
  publicDir: '../public',
  plugins: [ffmpegCoreAssets()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
