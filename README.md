# Forja

**Un estudio de archivos que funciona entero dentro del navegador.** Convierte y
edita imagen, audio y vídeo sin que ningún byte salga de tu dispositivo: no hay
servidor, no hay cuentas y no hay subidas.

---

## Cómo arrancarlo

Forja es un sitio **estático** hecho con Vite. **No se puede abrir el
`index.html` haciendo doble clic**: hay que compilarlo o levantar el servidor de
desarrollo.

Necesitas [Node.js](https://nodejs.org) 20 o superior.

```bash
# 1. Instalar las dependencias (la primera vez tarda, baja ~65 MB de WebAssembly)
npm install

# 2. Arrancar en modo desarrollo
npm run dev
```

Abre la dirección que imprime la terminal, normalmente **http://localhost:5173**.

### Para generar la versión de producción

```bash
npm run build     # deja el resultado en dist/
npm run preview   # sirve dist/ en http://localhost:4173 para comprobarlo
```

> **Importante:** `dist/` **no** se puede abrir con `file://`. Necesita servirse
> por HTTP, porque los módulos y los archivos WebAssembly no se cargan desde el
> sistema de archivos. `npm run preview` es para eso.

---

## Publicarlo en internet

Forja es estático, así que vale cualquier hosting de archivos, **con una
condición**: para que ffmpeg use varios hilos hace falta servir dos cabeceras
(`COOP` y `COEP`). Sin ellas la aplicación funciona igual, solo que más lenta.

| Hosting | Qué hacer | Cabeceras |
| --- | --- | --- |
| **Netlify** | Conectar el repositorio. `netlify.toml` ya está. | ✅ vía `public/_headers` |
| **Cloudflare Pages** | Build: `npm run build`, salida: `dist` | ✅ vía `public/_headers` |
| **Vercel** | Conectar el repositorio. `vercel.json` ya está. | ✅ |
| **GitHub Pages** | Funciona, pero **no permite cabeceras propias** | ❌ ffmpeg irá en un solo hilo |

Puedes comprobar si el aislamiento está activo en **Ajustes → Rendimiento**
dentro de la propia aplicación.

---

## Qué hace, exactamente

Sueltas un archivo (o lo pegas, o lo eliges). Forja mira los **primeros bytes**
para saber qué es —no la extensión— y abre el espacio de trabajo que
corresponda.

### Convertir · para imagen, audio y vídeo

- **Audio →** MP3, WAV, OGG, FLAC, M4A
- **Vídeo →** MP4, WebM, MKV, MOV, H.265, GIF, y extraer el audio a cualquier
  formato de la lista anterior
- **Imagen →** PNG, JPG, WebP, AVIF (si el navegador sabe), BMP, GIF
- Cola con varios archivos, progreso real con tiempo restante, cancelar, y
  descarga individual o **en ZIP**

### Imagen · quitar el fondo de tres formas, combinables

1. **Por color** — cuentagotas, tolerancia, suavizado de borde y modo «solo la
   zona conectada»
2. **Con IA** — un modelo que se ejecuta **en tu dispositivo** (ver más abajo)
3. **A mano** — borrador y pincel de restauración con tamaño, dureza y opacidad

Se pueden encadenar en cualquier orden sobre la misma imagen. Además: recortar,
girar, voltear, redimensionar, brillo, contraste, saturación, poner un fondo
nuevo de color o imagen, y exportar a PNG, WebP o JPG.

### Audio · editor de onda

Selección arrastrando, reproducción con bucle, medidor de nivel,
cortar/copiar/pegar/borrar/recortar, insertar silencio, deshacer y rehacer, y
catorce efectos con **vista previa no destructiva**: volumen, normalizar,
fundidos, invertir, silenciar, velocidad, tono, ecualizador, reverberación, eco,
compresor y filtros paso alto y paso bajo.

### Vídeo · editor multipista

Pistas de vídeo, texto y audio; dividir, recortar bordes, mover, duplicar,
eliminar (con o sin cerrar el hueco), bloquear, ocultar y silenciar pistas;
posición, escala, rotación, opacidad, recorte, velocidad, volumen y fundidos;
texto con fuentes propias, contorno, sombra, fondo y animaciones; transiciones;
ajustes de color; fotogramas clave; y guardado automático del proyecto.

La exportación es **determinista**: renderiza fotograma a fotograma, no graba la
pantalla. El resultado no depende de la velocidad de tu equipo.

---

## Sobre el modelo de IA

El modelo para quitar fondos **no viene incluido**. Se descarga la primera vez
que lo pides, con barra de progreso, y se queda en la caché del navegador. La
aplicación te dice **el tamaño y la licencia antes de descargar nada**.

Se usa **U²-Net** (Apache-2.0). Se descartaron los modelos más conocidos del
sector —RMBG-1.4, MODNet, `@imgly/background-removal`— porque sus licencias
prohíben el uso comercial o son AGPL. Está razonado en
[`PLAN.md`](PLAN.md) §5.

Si tu red bloquea la descarga, el panel lo dice y ofrece **cargar un `.onnx`
desde tu disco**, que funciona sin conexión.

---

## Qué navegadores

| | Estado |
| --- | --- |
| **Chrome / Edge** (escritorio, últimas versiones) | Todo funciona. Es donde está probado. |
| **Firefox** | Funciona. Sin `SharedArrayBuffer` en algunas configuraciones → ffmpeg en un hilo. |
| **Safari** | Funciona lo principal. Puede no soportar AVIF al exportar; la opción no aparece si no. |
| **Móvil** | Convertidor y editor de imagen. Los editores de audio y vídeo necesitan pantalla y ratón. |

Forja **comprueba** lo que el navegador sabe hacer antes de ofrecerlo. Si AVIF
no se puede codificar, la opción no está. Nunca aparece un botón que no
funcione.

Lo mismo se aplicó al propio ffmpeg.wasm: tres codificadores que figuran en su
lista resultaron estar rotos al ejecutarlos (VP9, Opus en estéreo y el filtro
`drawtext` sin fuente). Se midieron uno a uno y se retiraron o se sustituyeron.
Está todo en [`PLAN.md`](PLAN.md) §3.

### Accesibilidad

Auditada con **axe-core contra la interfaz real**, no a ojo: hay un test
end-to-end por pantalla que falla si aparece cualquier violación de WCAG 2.1 AA
de gravedad seria o crítica, más uno que recorre la interfaz con el tabulador y
falla si el foco cae en un control invisible.

Esa auditoría encontró que el color de texto atenuado daba 4,00:1 en el tema
oscuro y 4,47:1 en el claro, ambos por debajo del umbral. Los tokens se
recalcularon contra el fondo más desfavorable de cada tema.

---

## Rendimiento, medido

Con los archivos que el encargo fija como criterio de aceptación, en Chromium:

| Archivo | Operación | Tiempo | Memoria |
| --- | --- | --- | --- |
| PNG de 8,3 Mpx (3840×2160) | abrir en el editor | 1,0 s | 195 MB |
| | quitar el fondo por color | 0,7 s | |
| | exportar a PNG | 0,5 s | |
| MP3 de 10 minutos | abrir en el editor de audio | 3,8 s | 569 MB |
| | normalizar y aplicar | 0,8 s | |
| | redibujar la onda con zoom | 0,6 s | |
| Vídeo 1080p de 2 minutos | abrir en el editor de vídeo | 0,4 s | 572 MB |
| | dividir en el cabezal | 0,2 s | |

Cero errores de consola en todas ellas.

La memoria del audio es alta a propósito y es predecible: diez minutos en
estéreo a 44,1 kHz en coma flotante son 211 MB por copia, y el editor guarda la
versión aplicada más el historial. El historial se limita **por bytes**, no por
número de pasos, justamente para que esto no crezca sin control.

El paquete inicial son **312 kB** (98 kB comprimido). Cada editor es un trozo
aparte que se descarga solo cuando se abre, y ffmpeg.wasm (32 MB) y el modelo de
IA solo cuando se usan.

---

## Desarrollo

```bash
npm run dev         # servidor de desarrollo
npm run build       # compila a dist/
npm run preview     # sirve dist/
npm run typecheck   # TypeScript en modo estricto
npm run lint        # ESLint
npm test            # tests unitarios (Vitest)
npm run e2e         # tests end-to-end (Playwright)
npm run fixtures    # regenera los archivos de prueba (necesita ffmpeg)
```

### Los tests end-to-end

No comprueban que aparezca un botón: **descargan el archivo que la aplicación
genera y lo verifican de verdad**. Que un JPG empiece por `FF D8 FF`, que un OGG
empiece por `OggS`, que el PNG exportado tenga el canal alfa a cero donde estaba
el fondo, que el audio exportado dure lo que debe.

Necesitan un Chromium. Si ya tienes uno en el sistema:

```bash
FORJA_CHROME=/ruta/a/chrome npm run e2e
# o, para que Playwright se descargue el suyo:
npx playwright install chromium && npm run e2e
```

Los archivos de prueba se generan con `npm run fixtures` y **no** están en el
repositorio: son binarios reproducibles. Lo que sí está son las **cabeceras**
—los primeros cuatro kilobytes de cada uno, que es justo lo que lee el detector
de formatos—, para que `npm test` funcione recién clonado sin necesidad de
ffmpeg. Los tests end-to-end sí necesitan los archivos completos, y te lo dicen
con ese mismo comando si faltan.

---

## Licencia

**GPL-3.0-or-later.** No es la elección que hubiéramos preferido: el núcleo de
ffmpeg.wasm que permite exportar MP4 con H.264 está compilado con
`--enable-gpl`, así que arrastra a todo el proyecto. La alternativa era renunciar
al H.264 —es decir, al MP4 que cualquiera espera poder abrir—. Está razonado en
[`PLAN.md`](PLAN.md) §6, con las opciones y sus costes.

Las fuentes empaquetadas están bajo SIL Open Font License 1.1; los textos de las
licencias están en `public/fonts/OFL/`.

---

## Documentación técnica

[`PLAN.md`](PLAN.md) contiene las decisiones, los riesgos, las licencias de cada
dependencia y —lo más útil— **lo que se midió en un navegador real** en lugar de
suponerlo: qué códecs trae de verdad este build de ffmpeg.wasm, por qué no hay
AV1, por qué sí hay H.265, y por qué el texto no se dibuja con `drawtext`.
