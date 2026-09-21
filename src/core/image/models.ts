/**
 * The segmentation models Forja is willing to run.
 *
 * Licensing drove this list more than accuracy did. The best-known
 * background-removal weights (BRIA RMBG-1.4, MODNet, the model inside
 * @imgly/background-removal) are all restricted to non-commercial use or are
 * AGPL, so none of them are here. See PLAN.md section 5.
 *
 * Nothing is bundled: a model is fetched the first time someone asks for it,
 * with visible progress, and then cached. A local `.onnx` file can be used
 * instead, which also makes the whole pipeline testable without a network.
 */

export interface SegmentationModel {
  readonly id: string;
  readonly name: string;
  readonly license: string;
  readonly licenseUrl: string;
  /** Approximate download size, shown before the download starts. */
  readonly sizeBytes: number;
  readonly url: string;
  /** Models of this family take a square input. */
  readonly inputSize: number;
  readonly mean: readonly [number, number, number];
  readonly std: readonly [number, number, number];
  /**
   * How to turn the raw output map into 0–1.
   * `minmax` rescales against the map's own range, which is what the U²-Net
   * family expects; `sigmoid` is for models that emit logits.
   */
  readonly output: 'minmax' | 'sigmoid';
}

export const MODELS: readonly SegmentationModel[] = [
  {
    id: 'u2netp',
    name: 'U²-Net (ligero)',
    license: 'Apache-2.0',
    licenseUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
    sizeBytes: 4_700_000,
    url: 'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2netp.onnx',
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    output: 'minmax',
  },
  {
    id: 'u2net',
    name: 'U²-Net (completo)',
    license: 'Apache-2.0',
    licenseUrl: 'https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE',
    sizeBytes: 176_000_000,
    url: 'https://huggingface.co/tomjackson2023/rembg/resolve/main/u2net.onnx',
    inputSize: 320,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    output: 'minmax',
  },
];

export const DEFAULT_MODEL = MODELS[0]!;

export function modelById(id: string): SegmentationModel | undefined {
  return MODELS.find((model) => model.id === id);
}

/** The shape a user-supplied `.onnx` file is run with. */
export function customModel(name: string, inputSize = 320): SegmentationModel {
  return {
    id: 'custom',
    name,
    license: '—',
    licenseUrl: '',
    sizeBytes: 0,
    url: '',
    inputSize,
    mean: [0.485, 0.456, 0.406],
    std: [0.229, 0.224, 0.225],
    output: 'minmax',
  };
}
