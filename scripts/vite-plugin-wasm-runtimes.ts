import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);

/** Files lifted out of the `@ffmpeg/core*` packages, keyed by the path we serve them at. */
const CORE_FILES: Record<string, string> = {
  'ffmpeg/core/ffmpeg-core.js': '@ffmpeg/core/dist/esm/ffmpeg-core.js',
  'ffmpeg/core/ffmpeg-core.wasm': '@ffmpeg/core/dist/esm/ffmpeg-core.wasm',
  'ffmpeg/core-mt/ffmpeg-core.js': '@ffmpeg/core-mt/dist/esm/ffmpeg-core.js',
  'ffmpeg/core-mt/ffmpeg-core.wasm': '@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm',
  'ffmpeg/core-mt/ffmpeg-core.worker.js': '@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js',

};

const MIME: Record<string, string> = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
};

/**
 * The `@ffmpeg/*` packages expose a narrow `exports` map that hides both
 * `dist/esm/*` and `package.json`, so resolve the package entry point and walk
 * up to the package root instead of asking for a subpath directly.
 */
export function packageRoot(pkg: string): string {
  let dir = path.dirname(require.resolve(pkg));
  while (!existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Cannot locate the root of ${pkg}`);
    dir = parent;
  }
  return dir;
}

function resolveSource(spec: string): string {
  const parts = spec.split('/');
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
  return path.join(packageRoot(pkg), spec.slice(pkg.length + 1));
}

/**
 * Serves (dev) and emits (build) the ffmpeg.wasm cores straight from
 * `node_modules`.
 *
 * ONNX Runtime is not here: its glue script is imported normally, so the
 * bundler emits its `.wasm` once and the worker points the runtime at that
 * exact URL.
 *
 * Self-hosting matters twice over: a third-party CDN would undercut the
 * "nothing leaves your device" promise, and cross-origin isolation makes
 * CDN loading needlessly awkward.
 */
export function wasmRuntimeAssets(): Plugin {
  return {
    name: 'forja:wasm-runtime-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const key = (req.url ?? '').split('?')[0]?.replace(/^\//, '') ?? '';
        const source = CORE_FILES[key];
        if (!source) return next();
        const file = resolveSource(source);
        void stat(file).then(
          (info) => {
            res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream');
            res.setHeader('Content-Length', info.size);
            // The pthread worker is itself fetched from a cross-origin
            // isolated page, so it must carry COEP or Chromium rejects it
            // with ERR_BLOCKED_BY_RESPONSE.
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
            res.setHeader('Cache-Control', 'no-cache');
            createReadStream(file).pipe(res);
          },
          () => next(),
        );
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(CORE_FILES)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(resolveSource(source)) });
      }
    },
  };
}
