import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { transformWithOxc, type Plugin, type ResolvedConfig } from 'vite';
import { packageRoot } from './vite-plugin-wasm-runtimes.ts';

/**
 * Ficheros de `public/` que no deben precargarse.
 *
 * `fixtures/` son los archivos de prueba de los tests end-to-end y `_headers`
 * es configuración del hosting: ninguno de los dos tiene sentido dentro de una
 * caché de aplicación.
 */
const PUBLIC_EXCLUDED = new Set(['fixtures', '_headers']);

/** Solo lo pequeño entra en la precarga; lo grande se guarda al usarlo. */
const MAX_PRECACHE_BYTES = 1_000_000;

function listPublicFiles(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (PUBLIC_EXCLUDED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listPublicFiles(full, rel));
    else if (statSync(full).size <= MAX_PRECACHE_BYTES) out.push(rel);
  }
  return out;
}

/**
 * Compila `src/pwa/sw.ts` y lo emite como `sw.js` en la raíz del sitio.
 *
 * Tiene que estar en la raíz porque el alcance de un service worker no puede
 * subir por encima de su propia URL: uno servido desde `/assets/` solo
 * controlaría `/assets/`.
 *
 * La lista de precarga se calcula aquí, con el bundle ya resuelto, porque es la
 * única forma de saber los nombres con hash de los ficheros de esta compilación.
 */
export function pwa(): Plugin {
  let config: ResolvedConfig;

  return {
    name: 'forja:pwa',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    async generateBundle(_options, bundle) {
      const base = config.base;

      const built = Object.values(bundle)
        .filter((file) => {
          // El runtime de ONNX pesa 14 MB: se guarda cuando se recorta un
          // fondo por primera vez, no antes.
          if (file.fileName.endsWith('.wasm') || file.fileName.endsWith('.mjs')) return false;
          return !file.fileName.startsWith('ffmpeg/');
        })
        .map((file) => file.fileName);

      const publicFiles = listPublicFiles(path.resolve(config.root, config.publicDir));

      const shell = `${base}index.html`;
      const precache = [
        shell,
        ...[...built, ...publicFiles].sort().map((name) => `${base}${name}`),
      ];

      // El identificador del build sale de la lista misma: los nombres llevan
      // el hash del contenido, así que si cambia algo, cambia la caché.
      const buildId = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);

      // Los núcleos de ffmpeg no cambian entre compilaciones, solo cuando se
      // actualiza el paquete. Separar su caché evita volver a bajar 63 MB en
      // cada despliegue.
      const coreVersion = (
        JSON.parse(
          readFileSync(path.join(packageRoot('@ffmpeg/core'), 'package.json'), 'utf8'),
        ) as { version: string }
      ).version;

      const source = readFileSync(path.resolve(config.root, 'src/pwa/sw.ts'), 'utf8');
      // Las constantes se anteponen como un preámbulo en vez de pasarse por
      // `define`: los `declare const` del fuente no emiten nada, así que el
      // preámbulo es lo único que las define en el fichero final. Un
      // transformador menos que tiene que entendernos.
      const preamble = [
        `const __SHELL_CACHE__ = ${JSON.stringify(`forja-shell-${buildId}`)};`,
        `const __RUNTIME_CACHE__ = ${JSON.stringify(`forja-runtime-${coreVersion}`)};`,
        `const __SHELL__ = ${JSON.stringify(shell)};`,
        `const __PRECACHE__ = ${JSON.stringify(precache)};`,
      ].join('\n');

      // `transformWithOxc` es el transformador que Vite 8 ya trae dentro, así
      // que esto no añade ninguna dependencia nueva al proyecto.
      const { code } = await transformWithOxc(source, 'sw.ts', { lang: 'ts', target: 'es2022' });

      this.emitFile({ type: 'asset', fileName: 'sw.js', source: `${preamble}\n${code}` });
    },
  };
}
