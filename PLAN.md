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


### 3.6 Lo que el listado de codificadores no dice (medido en la fase 5)

Que un codificador aparezca en `-encoders` significa que se compiló, **no que
funcione**. Tres cosas se descubrieron ejecutándolo, no leyéndolo, y cada una
obligó a cambiar una decisión ya tomada:

| Intento | Resultado |
| --- | --- |
| `libvpx-vp9` (VP9), en **cualquier** configuración probada: con y sin `-row-mt`, `-deadline good` y `realtime`, `-threads 1`, modo bitrate constante | ❌ **`memory access out of bounds` tras el primer fotograma** |
| `libvpx` (VP8) | ✅ funciona; con `-deadline realtime -cpu-used 5` es **4× más rápido** (411 ms frente a 1565 ms) |
| `libopus` con entrada **estéreo**, a 44,1 kHz y a 48 kHz, VBR y CBR, en contenedor Ogg y en Matroska | ❌ **`memory access out of bounds`** |
| `libopus` con entrada **mono** | ✅ funciona |
| `libvorbis` en WebM | ✅ funciona |
| `aac` en MP4, desde WAV de coma flotante o de 16 bits | ✅ funciona |
| Demuxer `concat` y muxeo con `-c:v copy` | ✅ funciona |

**Consecuencias, ya aplicadas:**

* **WebM usa VP8 + Vorbis**, no VP9 + Opus. Comprime peor; es lo que este núcleo
  sabe producir sin romperse.
* **Opus se ha retirado** de la lista de formatos de salida. Ofrecerlo sabiendo
  que falla con cualquier archivo estéreo —es decir, con casi todos— sería
  precisamente el tipo de botón decorativo que este proyecto no admite. Forja
  sigue **leyendo** Opus sin problema; lo que no hace es escribirlo.
* Hay **tests unitarios que vigilan las tres cosas**: que los argumentos de WebM
  no contengan `libvpx-vp9` ni `-row-mt`, y que ningún tipo de archivo ofrezca
  `opus` como destino.

**Cómo se coló hasta la fase 5.** El spike de la fase 0 comprobó que los
codificadores *existían* y el test E2E de WebM **cancelaba la conversión antes
de que el codificador llegara a arrancar**. Un test que cancela no prueba nada.
Ahora hay dos tests que **completan**: uno que convierte a todos los formatos de
audio y comprueba cada archivo, y otro que lleva una conversión WebM hasta el
final y verifica la cabecera EBML del resultado.

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
| 2 | Convertidor (audio, vídeo, imagen) con cola y ZIP | ✅ |
| 3 | Editor de imagen y los tres métodos de recorte de fondo | ✅ |
| 4 | Editor de audio: onda, edición y efectos | ✅ |
| 5 | Editor de vídeo multipista | ✅ |
| 6 | Visualizador de audio | ✅ |
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

## 10. Cierre de la fase 2

**Funciona, comprobado con archivos reales en Chromium:** audio → MP3, WAV, OGG,
Opus, FLAC y M4A; vídeo → MP4, WebM, MKV, MOV, H.265 y GIF; extracción del audio
de un vídeo a cualquier formato de audio; imagen → PNG, JPG, WebP, AVIF (si el
navegador lo permite), BMP y GIF. Cola con varios archivos, progreso real con
tiempo restante, cancelación y descarga individual o en ZIP.

**Dos motores, según lo que convenga:**

* **El codificador del navegador** para PNG, JPG, WebP y AVIF, en un Web Worker.
  Convertir una foto no debería costar una descarga de 32 MB, y así no la cuesta.
* **ffmpeg.wasm** para todo lo demás. Se descarga la primera vez que hace falta,
  con barra de progreso real, y se queda en la caché.

**Decisiones y detalles que no son obvios:**

* La lista de formatos de salida sale de lo que este build soporta de verdad
  (§3.2), no de la documentación de ffmpeg. Por eso no hay AV1 y sí hay H.265,
  este último con un aviso sobre la reproducción.
* AVIF solo aparece si `canvas.toDataURL('image/avif')` responde que sí. Si el
  navegador miente y devuelve un PNG con otra etiqueta, la conversión falla de
  forma explícita en lugar de entregar un archivo mal nombrado.
* El GIF se genera en dos pasadas con `palettegen`/`paletteuse` y **la misma
  cadena de filtros en ambas**; si no coinciden, la paleta no corresponde a los
  fotogramas y el resultado se ve sucio. Hay un test que lo vigila.
* `scale=trunc(iw/2)*2:trunc(ih/2)*2` incluso al «mantener el original»: H.264 y
  VP9 con croma 4:2:0 rechazan dimensiones impares.
* Los presets de x264 son `veryfast` salvo en calidad alta: en WebAssembly un
  preset lento triplica la espera para una mejora que casi no se ve.
* Cancelar termina el worker, porque ffmpeg.wasm no sabe interrumpir un comando
  en marcha. La interfaz lo dice antes de que el usuario se pregunte por qué la
  siguiente conversión tarda más en arrancar.
* Aviso de tamaño antes de empezar (512 MB) y confirmación explícita por encima
  de 2 GB. Nunca se impide, se informa.

**Comprobaciones:** 53 tests unitarios (incluidos los argumentos de ffmpeg de
cada destino) y 15 end-to-end que convierten archivos de verdad y comprueban la
firma binaria de lo descargado: un JPG que empieza por `FFD8FF`, un OGG que
empieza por `OggS`, un ZIP que empieza por `PK`. Cero errores de consola.

## 11. Cierre de la fase 3

**Funciona, comprobado con archivos reales en Chromium:** los tres métodos de
quitar el fondo, combinables en cualquier orden sobre la misma imagen; recortar
con proporciones fijas, girar en cuartos de vuelta, voltear, redimensionar;
brillo, contraste y saturación con vista previa en vivo; fondo nuevo de color o
imagen; y exportación a PNG, WebP y JPG con control de calidad.

**El motor no depende de React.** `src/core/image/editor.ts` es una clase
corriente que posee píxeles, máscara, historial y vista previa; la interfaz se
suscribe con `useSyncExternalStore`. Eso permite probarlo sin DOM (13 tests) y
es lo que pedía el encargo sobre separar el motor de la interfaz.

**Por qué píxeles y máscara van separados.** Los tres métodos escriben en la
misma máscara de un byte por píxel y **nunca** tocan los píxeles originales. De
ahí salen dos propiedades que el encargo pedía y que están cubiertas por tests:
los métodos se acumulan en cualquier orden con el mismo resultado, y una pasada
nunca resucita lo que otra borró (se toma el mínimo). El pincel restaurador es
la única forma de devolver algo, que es exactamente lo que se espera.

**Detalles que no son obvios:**

* La distancia de color se mide en luma/croma con la croma pesando el triple.
  En RGB puro, una sombra sobre el fondo verde está tan «lejos» como un cambio
  de tono, y el resultado es o bien halos o bien agujeros en el sujeto. La
  escala (100 % = 400) está elegida contra números medidos, no a ojo: un verde
  y ese mismo verde en sombra distan unos 85; un verde y un rojo, unos 590.
* El relleno por zona conectada usa una pila explícita con arrays tipados. La
  recursión desborda la pila con cualquier fotografía real.
* El historial se limita **por memoria, no por número de pasos**: una instantánea
  de una foto de 60 Mpx ocupa 300 MB y una de un icono, 160 kB. Contar bytes deja
  historial generoso en imágenes pequeñas sin agotar la pestaña en las grandes.
* La máscara se reescala con interpolación bilineal propia al redimensionar: un
  canvas no puede transportar un canal único, y el vecino más cercano deja el
  borde del recorte en escalera.
* La exportación dibuja exactamente lo mismo que la vista previa, en el mismo
  orden y con el mismo filtro. Cualquier otra cosa y el archivo guardado no
  coincidiría con lo que se vio.

**Sobre el modelo de IA, sin adornos.** La tubería completa —descarga con
progreso, caché, preprocesado, sesión ONNX, postprocesado y reescalado de la
máscara— **está verificada de extremo a extremo en un navegador real**, con un
modelo ONNX sintético generado por `scripts/make-test-model.py` que devuelve el
canal rojo. Sobre la imagen de prueba (fondo verde, cuadrado rojo) el test
comprueba que el cuadrado sobrevive y el fondo se va, leyendo el canal alfa del
PNG exportado.

Lo que **no** se ha podido comprobar aquí son los pesos reales de U²-Net: el
entorno de desarrollo tiene bloqueado `huggingface.co` por política de red. Por
eso el panel de IA hace dos cosas: dice el tamaño y la licencia **antes** de
descargar nada, y si la descarga falla lo explica y ofrece cargar un `.onnx`
del disco, que funciona sin red alguna. Queda pendiente una prueba manual de la
calidad del recorte con los pesos reales en una red sin restricciones.

**Comprobaciones:** 125 tests unitarios y 23 end-to-end. Los del editor no
comprueban que aparezca un botón: descargan el archivo exportado, lo vuelven a
decodificar en el navegador y leen píxeles concretos para verificar que la
transparencia, el color de relleno del JPG y el fondo nuevo son los correctos.

## 12. Cierre de la fase 4

**Funciona, comprobado con archivos reales:** forma de onda con zoom y
desplazamiento, selección arrastrando, reproducción de la selección con bucle,
medidor de nivel con aviso de saturación, cortar/copiar/pegar/borrar/recortar,
insertar silencio, deshacer y rehacer, catorce efectos con vista previa no
destructiva y exportación a MP3, WAV, OGG, Opus, FLAC y M4A.

**El cabezal no es la selección.** Un arrastre de cero píxeles es una posición
del cursor, no «nada seleccionado». Confundirlos obliga a equivocarse en una de
dos cosas: o un efecto sin selección se aplica solo al cursor, o pegar sin
selección ignora dónde está el cursor. Son campos distintos, y hay tests para
ambos comportamientos.

**Estirado temporal propio (WSOLA).** El tono y la velocidad con tono fijo
necesitan estirar el tiempo. Las alternativas se descartaron con motivo:
`rubberband` no está en este build de ffmpeg (§3.2), encadenar `atempo` obligaría
a descargar 32 MB de WebAssembly para mover un deslizador, y un solapamiento sin
búsqueda produce el timbre metálico que todo el mundo reconoce. La búsqueda de
alineación por correlación es lo que lo hace aceptable. Los tests lo verifican
midiendo la frecuencia por cruces por cero: estirar al doble mantiene 440 Hz,
subir una octava da ~880 Hz **sin** cambiar la duración.

**Reparto entre código propio y el navegador.** Ganancia, normalizar, fundidos,
invertir y silenciar se escriben directamente sobre las muestras: son pocas
líneas y funcionan igual en un test que en el navegador. Ecualizador,
reverberación, eco, compresor y filtros van por `OfflineAudioContext`, porque
los nodos del navegador están bien probados y suenan exactamente igual que en
la reproducción.

**Detalles que no son obvios:**

* Las colas de reverberación y eco **se mezclan sobre el audio que viene
  después** en lugar de cortarse al final de la selección. Cortarlas deja un
  corte audible.
* La respuesta al impulso de la reverberación se genera (ruido con decaimiento
  exponencial y caída de agudos) en vez de empaquetar una grabación real: un
  impulso de verdad ocupa más de un megabyte por preset.
* Los fundidos usan potencia constante por defecto. Un fundido lineal suena
  como si se hundiera por la mitad, porque la sonoridad va con el cuadrado de
  la amplitud.
* La posición de reproducción sale del reloj de audio, no de un temporizador:
  `setInterval` deriva respecto al hardware y el cabezal se despegaría de la onda.
* Los picos de la onda se cachean por (ventana, ancho, revisión de muestras).
  Una pista de diez minutos son 26 millones de muestras por canal; recalcularlas
  al arrastrar el cabezal haría el editor inusable.
* El historial se limita por memoria: una instantánea de diez minutos en estéreo
  ocupa 200 MB.
* La vista previa descarta resultados obsoletos con un testigo. Arrastrar un
  deslizador lanza una petición por fotograma y algunos efectos tardan decenas
  de milisegundos, así que llegan desordenadas.

**Un defecto encontrado por el pantallazo, no por los tests:** el botón
«Recortar a la selección» se desbordaba sobre el de al lado, y el sufijo de
unidad de los deslizadores caía a una línea propia. Los tests pasaban igual.
Ambos corregidos.

**Comprobaciones:** 225 tests unitarios y 33 end-to-end. Los del audio no miran
la interfaz: descargan el archivo exportado, lo descodifican en el navegador y
comprueban duración, número de canales y pico. Normalizar sube de −30 dB a
cerca de la escala completa; duplicar la velocidad con tono fijo deja el
archivo en la mitad de duración; silenciar deja el pico por debajo de 0,001.

## 13. Cierre de la fase 5

**Funciona, comprobado con archivos reales:** proyecto multipista con pistas de
vídeo, texto y audio; dividir, recortar bordes arrastrando, mover entre pistas,
duplicar, eliminar con y sin cerrar el hueco; bloquear, ocultar y silenciar
pistas; posición, escala, rotación, opacidad, recorte, velocidad, volumen,
fundidos y transiciones; texto con seis fuentes empaquetadas, contorno, sombra,
caja de fondo, alineación y animaciones de entrada y salida; ajustes de color;
fotogramas clave de opacidad, posición y escala; imán, zoom, deshacer y rehacer
ilimitados; guardado automático; y exportación a MP4 y WebM.

**El modelo de proyecto es JSON puro.** Ni React ni DOM dentro. `renderFrame()`
es una función sobre ese objeto y **la usan igual la vista previa y el
exportador**. Esa es la única garantía real de que lo exportado coincide con lo
previsualizado; cualquier otra cosa es una promesa.

**La exportación es determinista de verdad.** Cada fotograma de salida se obtiene
buscando la posición exacta en cada vídeo que interviene y componiendo. No se
graba la pantalla, así que el resultado no depende de la velocidad del equipo:
una máquina lenta tarda más, no produce un vídeo peor. Los fotogramas se
codifican **por segmentos** y se unen al final; mantener las imágenes de una
película entera en el sistema de archivos WebAssembly agotaría la memoria mucho
antes de llegar al codificador.

**Deshacer es ilimitado aquí y limitado en los otros editores**, y no por
descuido: un proyecto de vídeo son unos kilobytes de JSON por mucho metraje que
referencie, mientras que una instantánea de una foto de 60 Mpx ocupa 300 MB.

**Detalles que no son obvios:**

* El cabezal manda sobre los elementos `<video>`, no al revés. Es lo que hace que
  el desplazamiento, el bucle y los cambios de velocidad se comporten; cualquier
  elemento que se desvíe más de unas centésimas se corrige.
* **El audio de la vista previa sale de los propios elementos**, y eso tiene un
  límite declarado: dos recortes del *mismo* archivo que se solapen no pueden
  sonar a la vez, porque hay un elemento por fuente. **La exportación no comparte
  esa limitación**: mezcla desde muestras descodificadas, así que lo que se
  escribe siempre está completo.
* Al dividir un recorte, el punto de entrada del segundo trozo avanza en tiempo
  **de origen**, no de línea de tiempo: un recorte a media velocidad consume
  material más despacio. Hay un test que lo fija.
* Recortar el borde izquierdo mueve también el punto de entrada, para que el
  contenido no se deslice bajo el cabezal.
* El guardado automático guarda **la estructura, no los archivos**: un navegador
  no puede quedarse con una referencia a un archivo del disco entre recargas.
  Los recortes recuerdan su origen por nombre y tamaño, y al reabrir se vuelven
  a enlazar; si falta alguno, se dice cuál.
* Una operación que no cambia nada devuelve **el mismo objeto**. Sin eso, pulsar
  algo inerte dejaba un paso de deshacer que no deshacía nada. Lo destapó un
  test, no una revisión.

**Comprobaciones:** 329 tests unitarios y 42 end-to-end. El de exportación
descarga el vídeo generado, lo descodifica en el navegador y comprueba duración
y resolución reales.

## 14. Cierre de la fase 6

**Funciona, comprobado en el navegador:** seis estilos —barras, barras en
espejo, línea de onda, circular, espectro de área y partículas—, cada uno con
colores y degradado, número de barras, grosor, tamaño, sensibilidad, suavizado,
brillo, reacción a los graves, simetría y rango de frecuencias. Fondo de color,
degradado o imagen con oscurecido; capa de texto con título, artista, fuente,
posición, color y tamaño; logo con posición, tamaño y opacidad. Proporciones
16:9, 9:16, 1:1 y 4:5, con resolución y fotogramas por segundo. Presets
guardables. Exportación a MP4 y WebM con el audio incluido.

**El audio se analiza entero antes de dibujar nada, y eso es la decisión
importante.** Un `AnalyserNode` devuelve lo que haya en su búfer en el instante
en que se le pregunta, que depende del momento exacto en que llegue el
fotograma. Con él, **exportar dos veces daría dos vídeos distintos**. Aquí el
fotograma número N siempre ve el mismo espectro, y hay un test que lo comprueba
comparando dos análisis del mismo audio.

Por el mismo motivo, **las partículas no se simulan**: su posición sale del
índice del fotograma mediante una fórmula fija (una espiral de ángulo áureo, que
las reparte sin que se amontonen). Un sistema con estado acumulado haría que
cada exportación fuese distinta, y se desviaría si algún fotograma se
recalculase.

**Detalles que no son obvios:**

* **La FFT está escrita a mano**, cuarenta líneas de radix-2 iterativo. Una
  dependencia más que auditar y licenciar para algo que se ejecuta una vez por
  fotograma sobre unos miles de muestras no compensaba.
* **Las bandas se reparten en escala logarítmica.** Con bandas lineales, nueve
  décimas partes de las barras cubrirían frecuencias que nadie distingue y los
  graves —lo único que se mueve de verdad— quedarían aplastados en las dos
  primeras.
* **El suavizado es asimétrico**: las subidas son instantáneas y las bajadas
  graduales. Una barra que llega tarde al golpe de un bombo parece rota; una que
  baja despacio, no.
* La ventana de análisis se **centra** en el instante del fotograma, no empieza
  en él, para que un pico coincida con la imagen en vez de ir medio búfer por
  detrás.
* Se suman los canales antes de analizar: un visualizador que reacciona solo al
  canal izquierdo se queda quieto en cuanto la música está panoramizada.

**Comprobaciones:** 361 tests unitarios y 47 end-to-end. Entre ellos, uno que
**lee los píxeles del canvas** y comprueba que los seis estilos pintan algo de
verdad, otro que verifica que un preset restaura la escena completa, y otro que
exporta un vídeo real y comprueba su cabecera EBML.
