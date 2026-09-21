/// <reference lib="webworker" />
// The `/wasm` entry point is the CPU-only build. Importing the default entry
// drags in the WebGPU (jsep) runtime as well, which is another 28 MB of assets
// for no benefit: these models run in well under a second on the CPU.
import * as ort from 'onnxruntime-web/wasm';
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { SegmentationModel } from './models';
import { postprocess, preprocess } from './segmentMath';
import { type ByteArray } from './bytes';

/**
 * Runs a segmentation model over a square thumbnail of the image.
 *
 * The main thread does the downscaling and sends only `inputSize²` pixels —
 * about 400 kB for a 320-pixel model — regardless of whether the photo is two
 * megapixels or sixty. The mask that comes back is upsampled there too. That
 * keeps every transfer small and the worker's job purely numerical.
 */

// Point the runtime at the exact assets the bundler emitted. Letting it guess
// from `import.meta.url` is unreliable once the glue script has been inlined,
// and leaving it to our own static copy would ship the 14 MB binary twice.
ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl };
// One thread: these models run in well under a second on a single core, and
// asking for more would require shipping the pthreads build as well.
ort.env.wasm.numThreads = 1;
ort.env.logLevel = 'error';

export interface SegmentRequest {
  readonly id: string;
  /** The model weights, already downloaded or read from a local file. */
  readonly weights: ArrayBuffer;
  readonly model: SegmentationModel;
  /** RGBA of the image scaled to `model.inputSize` square. */
  readonly rgba: ByteArray;
}

export type SegmentResponse =
  | { readonly id: string; readonly ok: true; readonly mask: ByteArray; readonly size: number; readonly ms: number }
  | { readonly id: string; readonly ok: false; readonly error: string };

/** Cached across calls: building a session is by far the slowest step. */
let session: ort.InferenceSession | undefined;
let sessionKey: string | undefined;

function keyFor(weights: ArrayBuffer): string {
  return `${weights.byteLength}`;
}

async function segment(request: SegmentRequest): Promise<SegmentResponse> {
  const started = performance.now();
  try {
    const key = keyFor(request.weights);
    if (!session || sessionKey !== key) {
      void session?.release?.();
      session = await ort.InferenceSession.create(request.weights, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      });
      sessionKey = key;
    }

    const size = request.model.inputSize;
    const tensor = new ort.Tensor(
      'float32',
      preprocess(request.rgba, size, request.model.mean, request.model.std),
      [1, 3, size, size],
    );

    const inputName = session.inputNames[0];
    if (!inputName) throw new Error('the model declares no input');
    const outputs = await session.run({ [inputName]: tensor });

    // Matting models often emit several side outputs; the first is the one at
    // full resolution and the one every reference implementation uses.
    const first = session.outputNames[0];
    const output = first ? outputs[first] : undefined;
    if (!output) throw new Error('the model returned no output');
    const raw = output.data;
    if (!(raw instanceof Float32Array)) throw new Error('unexpected output type');

    const expected = size * size;
    if (raw.length !== expected) {
      throw new Error(`expected ${expected} values, got ${raw.length}`);
    }

    return {
      id: request.id,
      ok: true,
      mask: postprocess(raw, request.model.output),
      size,
      ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

self.addEventListener('message', (event: MessageEvent<SegmentRequest>) => {
  void segment(event.data).then((response) => {
    (self as unknown as Worker).postMessage(response);
  });
});
