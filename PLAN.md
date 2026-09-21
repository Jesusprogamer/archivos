# Forja — plan técnico

> Estudio de archivos que funciona íntegramente en el navegador.
> Documento vivo: se actualiza al cerrar cada fase.

## 1. Principios

1. **Sin servidor.** Sitio estático. Ningún byte del archivo del usuario sale del
   dispositivo. No hay cuentas, ni telemetría, ni analítica.
2. **Nada decorativo.** Si un control aparece en la interfaz, hace lo que dice.
   Lo que no es viable en el navegador no se dibuja: se documenta aquí.
3. **Licencias comprobadas** antes de usar cada dependencia (§6).
4. **TypeScript estricto**, módulos pequeños, motor de render independiente de React.
5. **Español e inglés** desde el primer commit.

## 2. Stack

| Pieza | Elección | Motivo |
| --- | --- | --- |
| Build | Vite 8 + React 19 + TS 5.9 (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`) | Arranque rápido, *code splitting* por ruta y workers ES nativos. |
| Estado | Zustand | Sin *boilerplate*, fuera de React cuando hace falta (el motor de render lo lee directo). |
| Transcodificación | `@ffmpeg/ffmpeg` 0.12.15 + `@ffmpeg/core(-mt)` 0.12.10 | API `FFmpeg` moderna; el núcleo corre en un Web Worker propio. Una sola instancia reutilizada. |
| Audio | Web Audio API + `OfflineAudioContext` | Render determinista y más rápido que tiempo real. |
| Vídeo | Canvas 2D para componer; WebCodecs si está, ffmpeg.wasm si no | Ver §4.3. |
| Recorte de fondo | ONNX Runtime Web + modelo local | Ver §5. |
| ZIP | `fflate` | 8 kB, sin dependencias, *streaming*. |
| Iconos | `lucide-react` | Set único y coherente; sin emojis como iconos. |

Los núcleos de ffmpeg.wasm **se auto-alojan** (`scripts/vite-plugin-ffmpeg-core.ts`
los copia desde `node_modules`). Depender de un CDN contradiría la promesa de
privacidad y complica el aislamiento de origen.

## 3. Resultados de los spikes

Ejecutados en Chromium (headless, `crossOriginIsolated = true`) contra
`@ffmpeg/core(-mt)` 0.12.10. Código en `spikes/`, arranque con
`npm run spike`.

### 3.1 ffmpeg.wasm carga y convierte — **confirmado**

* Núcleo de un hilo: carga en **727 ms**.
* `tone.mp3` → `out.ogg` (libvorbis): código de salida 0, **19 413 bytes**,
  cabecera `OggS`, **173 ms**.
* Núcleo multihilo: carga en **1 386 ms**; transcodificación H.264 con
  `threads=4` confirmado en el log de x264, 784 ms.

### 3.2 Qué trae de verdad este núcleo

Configuración real del build (leída del log):

```
--enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libmp3lame
--enable-libtheora --enable-libvorbis --enable-libopus --enable-zlib --enable-libwebp
--enable-libfreetype --enable-libfribidi --enable-libass --enable-libzimg
```

| | Disponible | **No disponible** |
| --- | --- | --- |
| Vídeo | libx264, libx265, libvpx (VP8), libvpx-vp9, mpeg4, gif | **libaom-av1** |
| Audio | aac, libmp3lame, libvorbis, libopus, flac, pcm_s16le | — |
| Imagen | png, mjpeg, libwebp, bmp | **AVIF** (necesita AV1) |
| Muxers | mp4, webm, matroska, mp3, ogg, wav, flac, ipod (m4a), adts, gif, image2, opus | — |

**Consecuencias directas sobre el encargo:**

* **AV1 queda fuera.** No se ofrece en la interfaz. (El encargo lo daba por
  posible "si el build lo soporta": no lo soporta.)
* **H.265 sí está**, al contrario de lo que suponía el encargo. Se ofrece como
  opción avanzada, avisando de que muchos reproductores y navegadores no lo
  leen.
* **AVIF** solo por la vía del navegador (`canvas.toBlob('image/avif')`), y solo
  si el navegador lo soporta; se comprueba en tiempo de ejecución y si no, la
  opción no aparece.

### 3.3 `drawtext`: el riesgo era real

* Sin `fontfile`: el filtro **falla al inicializarse**
  (`Error initializing filter 'drawtext'`). El build no trae fuente por defecto.
* Con `fontfile` escrito en el FS virtual: **funciona** (código 0).

**Decisión:** el texto **no** se renderiza con `drawtext`. Se compone en canvas
y se superpone en la exportación. Motivos: `drawtext` no da contorno + sombra +
caja de fondo + animaciones de entrada/salida de forma razonable, y la vista
previa en canvas y la exportación deben usar exactamente el mismo código de
dibujo para que lo que se ve sea lo que sale.

### 3.4 WebCodecs

Disponible, pero **el soporte por códec hay que preguntarlo en caliente**. En el
Chromium headless de pruebas: VP8, VP9, AV1 y Opus sí; **H.264 y AAC no** (ese
build no incluye códecs con patentes). Chrome y Edge de escritorio sí los traen.

**Decisión:** WebCodecs es una vía rápida *opcional*, elegida tras
`isConfigSupported()`. ffmpeg.wasm es siempre el camino garantizado. Nunca se
promete un formato en la interfaz basándose en WebCodecs sin haberlo consultado.

### 3.5 Aislamiento de origen cruzado

Hallazgo que costó una tarde: con COEP activo, **el propio script del worker de
pthreads debe servirse con `Cross-Origin-Embedder-Policy: require-corp`**, no
basta con ponerlo en el HTML. Sin eso, Chromium lo rechaza con
`ERR_BLOCKED_BY_RESPONSE` y el núcleo multihilo no arranca. Está reflejado en el
plugin de Vite y en los archivos de cabeceras del despliegue.

## 4. Arquitectura

### 4.1 Registro de tipos de archivo

El núcleo no sabe nada de imágenes ni de vídeo. Cada tipo se declara en
`src/core/registry` con: firmas binarias, espacio de trabajo, formatos de
conversión de salida y exportadores. Añadir un tipo nuevo es añadir una entrada.

La detección lee los **magic bytes** (`src/core/detect`), no la extensión. La
extensión solo se usa como desempate cuando la firma es ambigua (por ejemplo
`.m4a` y `.mp4` comparten el contenedor ISO-BMFF; ahí se mira el `ftyp` y la
presencia de pistas).

### 4.2 Modelo de proyecto

El proyecto de vídeo es un objeto JSON serializable, sin nada de React dentro.
`renderFrame(project, t, ctx)` es una función pura sobre ese objeto: la usa
igual la vista previa que el exportador. Eso es lo que garantiza que la
exportación coincida con lo previsualizado.

### 4.3 Exportación de vídeo

Dos rutas, misma entrada:

1. **WebCodecs** (si `isConfigSupported` dice que sí): se codifican los
   fotogramas y se muxean con ffmpeg.wasm. Más rápido.
2. **ffmpeg.wasm**: se vuelcan los fotogramas como PNG/raw al FS virtual y se
   codifica. Siempre disponible.

En ambos casos el render es **fotograma a fotograma y determinista**, nunca una
grabación de pantalla en tiempo real.

### 4.4 Memoria

* Los archivos se guardan como `Blob`/`File`; nunca se mantienen `ArrayBuffer`
  completos en el *store*.
* `ffmpeg.writeFile()` **transfiere** el `Uint8Array` (queda *detached*). Lo
  descubrimos en el spike: el buffer de entrada quedó en 0 bytes. Todo el código
  que necesite el buffer después debe copiarlo antes.
* Se revocan los object URL al descartar un archivo de la biblioteca.
* Aviso explícito por encima de **512 MB** y bloqueo con confirmación por encima
  de **2 GB**: la codificación puede necesitar bastante más memoria que el
  propio archivo.

## 5. Recorte de fondo con IA — decisión de licencia

Descartados por licencia, pese a ser los más usados:

| Modelo | Licencia | Veredicto |
| --- | --- | --- |
| BRIA RMBG-1.4 | Solo uso no comercial | **Descartado** |
| MODNet (pesos) | CC BY-NC-SA | **Descartado** |
| `@imgly/background-removal` | AGPL / comercial | **Descartado** |

**Elegido: U²-Net**, publicado bajo **Apache-2.0**, en dos tallas: `u2netp`
(~4,7 MB, por defecto) y `u2net` (~176 MB, opcional). Alternativa contemplada y
también permisiva: **BiRefNet-lite (MIT)**.

La implementación no ata la aplicación a un modelo concreto: hay un registro
(`src/core/image/models.ts`) con URL, licencia, tamaño, tamaño de entrada y
normalización. Se puede apuntar a una copia auto-alojada.

> **Limitación de verificación, dicha sin adornos:** el entorno donde se
> desarrolla esto tiene bloqueado el acceso a `huggingface.co` por política de
> red, así que **no se ha podido descargar y ejecutar los pesos reales aquí**. Lo
> que sí se verifica automáticamente es toda la tubería de inferencia
> (descarga con progreso, caché, preprocesado, sesión ONNX, postprocesado a
> canal alfa) usando un modelo ONNX mínimo generado en local para las pruebas.
> La calidad del recorte con los pesos reales queda pendiente de una prueba
> manual en una red sin restricciones.

## 6. Licencias de terceros

| Paquete | Versión | Licencia | Por qué |
| --- | --- | --- | --- |
| react / react-dom | 19.3 | MIT | Interfaz. |
| zustand | 5.0 | MIT | Estado. |
| @ffmpeg/ffmpeg, @ffmpeg/util | 0.12 | MIT | Envoltorio. |
| **@ffmpeg/core, @ffmpeg/core-mt** | 0.12.10 | **GPL-2.0-or-later** | Ver aviso abajo. |
| fflate | 0.8 | MIT | ZIP. |
| lucide-react | 1.47 | ISC | Iconos. |
| onnxruntime-web | 1.30 | MIT | Inferencia local. |
| vite, vitest, eslint, typescript, playwright | — | MIT / Apache-2.0 | Herramientas de desarrollo. |
| Fuentes empaquetadas | — | SIL OFL 1.1 | Ver `public/fonts/OFL/`. |

### Aviso de licencia que hay que tener presente

El encargo pedía preferir MIT / Apache-2.0 / BSD. Se cumple **en todo salvo en
una pieza**: `@ffmpeg/core` está compilado con `--enable-gpl` (lleva libx264 y
libx265), por lo que es **GPL-2.0-or-later**. Al distribuirse junto a la
aplicación, **la aplicación entera queda bajo una licencia compatible con GPL**.
Por eso `LICENSE` es **GPL-3.0-or-later** y no MIT.

Las alternativas, por si se prefiere otra cosa:

1. **Aceptarlo** (lo elegido): H.264 y H.265 funcionan, proyecto GPL-3.0.
2. **Compilar un núcleo LGPL** sin x264/x265: permitiría licencia permisiva,
   pero se pierde la exportación a H.264 — es decir, se pierde el MP4 que
   cualquiera espera poder abrir. Coste alto para el usuario final.
3. **Solo WebCodecs para H.264**: depende del navegador y no cubre Firefox ni
   los Chromium sin códecs con patentes.

Se recomienda la opción 1 y así está implementado. **Si se prefiere una licencia
permisiva, hay que decirlo: es un cambio de rumbo, no un ajuste.**

## 7. Riesgos vivos

| Riesgo | Mitigación |
| --- | --- |
| Archivos grandes agotan la memoria | Umbrales de aviso y bloqueo (§4.4); se muestra el tamaño estimado en memoria antes de empezar. |
| Sin aislamiento de origen → un solo hilo | Se detecta `crossOriginIsolated` y se carga el núcleo que corresponda. La app funciona igual, más lenta, y lo dice en Ajustes. |
| GitHub Pages no permite cabeceras | Despliegue recomendado: Netlify / Vercel / Cloudflare Pages, con `public/_headers` y `vercel.json` en el repositorio. |
| `atempo` limita el cambio de velocidad a 0,5–2× | Se encadenan varias etapas de `atempo` para cubrir 0,25×–4×. |
| Safari: sin `SharedArrayBuffer` en algunas versiones, `OfflineAudioContext` con peculiaridades | Se documenta en el README y se degrada, no se rompe. |

## 8. Fases

| Fase | Contenido | Estado |
| --- | --- | --- |
| 0 | Spikes, decisiones, este documento | ✅ |
| 1 | Base: sistema de diseño, portada, detección, biblioteca, idiomas, tema | ✅ |
| 2 | Convertidor (audio, vídeo, imagen) con cola y ZIP | ⏳ |
| 3 | Editor de imagen y los tres métodos de recorte de fondo | ⏳ |
| 4 | Editor de audio: onda, edición y efectos | ⏳ |
| 5 | Editor de vídeo multipista | ⏳ |
| 6 | Visualizador de audio | ⏳ |
| 7 | Pulido, accesibilidad, documentación y despliegue | ⏳ |

## 9. Cierre de la fase 1

**Funciona, comprobado en Chromium:** detección por firma binaria de 28 formatos
(incluida la desambiguación de marcas ISO-BMFF, formas RIFF, DocType de EBML y
códec de Ogg), biblioteca de medios con miniaturas y metadatos leídos del propio
archivo, arrastrar/soltar/pegar en toda la ventana, español e inglés con cambio
en caliente, temas oscuro y claro persistidos, diálogos accesibles con trampa de
foco y atajos de teclado.

**Comprobaciones:** 34 tests unitarios y 9 end-to-end, cero errores de consola en
todos ellos, `tsc -b` y `eslint` limpios.

**Decisiones tomadas durante la fase:**

* Los espacios de trabajo se registran en `src/app/workspaceViews.ts` y la barra
  de pestañas se construye a partir de ese registro. Una pestaña que no tenga
  vista **no se dibuja**, así que en ningún momento del desarrollo hay un botón
  que no lleve a ninguna parte. Mientras no haya editor para un archivo, el área
  central muestra el inspector con lo que sabemos de él.
* El idioma por defecto es el español, salvo que el navegador declare inglés.
* TIFF y HEIC se **detectan** pero se rechazan con una explicación concreta: los
  navegadores no traen descodificador. Es más útil que un «archivo no válido».
