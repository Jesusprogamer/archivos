/**
 * Resolves a path to a file in `public/` against the deployment base.
 *
 * Vite rewrites asset URLs it can see (in HTML, CSS and `new URL(..., import.meta.url)`),
 * but the ffmpeg cores and the bundled fonts are fetched by paths we build at
 * runtime, so nothing rewrites those. Hard-coding a leading `/` worked only
 * while the app sat at the root of a domain; GitHub Pages serves it from
 * `/<repo>/`, where every one of those fetches would 404.
 *
 * `BASE_URL` always ends in `/`, so the argument must not start with one.
 */
export function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
