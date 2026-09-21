/**
 * The fonts the text tool offers.
 *
 * All bundled with the app and all under the SIL Open Font License, with the
 * licence texts in `public/fonts/OFL/`. Nothing is fetched from a font CDN:
 * that would leak which page a visitor is on to a third party, which is exactly
 * the kind of thing this project promises not to do.
 *
 * They are loaded on demand — a text layer is the only thing that needs them —
 * and only once, because `FontFace.load()` resolves from cache on later calls.
 */

import { assetUrl } from '../util/assets';

export interface FontDefinition {
  readonly family: string;
  readonly label: string;
  readonly weights: readonly number[];
  readonly italic: boolean;
  /** Files keyed by `${weight}${italic ? 'i' : ''}`. */
  readonly files: Readonly<Record<string, string>>;
}

export const FONTS: readonly FontDefinition[] = [
  {
    family: 'Instrument Sans',
    label: 'Instrument Sans',
    weights: [400, 700],
    italic: true,
    files: {
      '400': 'fonts/InstrumentSans-Regular.woff2',
      '700': 'fonts/InstrumentSans-Bold.woff2',
      '400i': 'fonts/InstrumentSans-Italic.woff2',
    },
  },
  {
    family: 'Outfit',
    label: 'Outfit',
    weights: [400, 700],
    italic: false,
    files: {
      '400': 'fonts/Outfit-Regular.woff2',
      '700': 'fonts/Outfit-Bold.woff2',
    },
  },
  {
    family: 'Lora',
    label: 'Lora',
    weights: [400, 700],
    italic: true,
    files: {
      '400': 'fonts/Lora-Regular.woff2',
      '700': 'fonts/Lora-Bold.woff2',
      '400i': 'fonts/Lora-Italic.woff2',
    },
  },
  {
    family: 'JetBrains Mono',
    label: 'JetBrains Mono',
    weights: [400, 700],
    italic: false,
    files: {
      '400': 'fonts/JetBrainsMono-Regular.woff2',
      '700': 'fonts/JetBrainsMono-Bold.woff2',
    },
  },
  {
    family: 'Big Shoulders',
    label: 'Big Shoulders',
    weights: [700],
    italic: false,
    files: { '700': 'fonts/BigShoulders-Bold.woff2' },
  },
  {
    family: 'Nothing You Could Do',
    label: 'Manuscrita',
    weights: [400],
    italic: false,
    files: { '400': 'fonts/NothingYouCouldDo-Regular.woff2' },
  },
];

export const DEFAULT_FONT = FONTS[0]!.family;

const loaded = new Set<string>();

/**
 * Loads every face of every bundled font.
 *
 * All of them together are under 400 kB, and the alternative — loading each
 * face when it is first selected — means the preview redraws a frame in the
 * wrong typeface before settling, which looks broken.
 */
export async function loadFonts(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return;
  const pending: Promise<unknown>[] = [];

  for (const font of FONTS) {
    for (const [key, url] of Object.entries(font.files)) {
      const id = `${font.family}:${key}`;
      if (loaded.has(id)) continue;
      loaded.add(id);
      const weight = key.replace('i', '');
      const face = new FontFace(font.family, `url(${assetUrl(url)}) format('woff2')`, {
        weight,
        style: key.endsWith('i') ? 'italic' : 'normal',
      });
      pending.push(
        face.load().then(
          (result) => document.fonts.add(result),
          () => {
            // A font that will not load falls back to the generic family; the
            // text still renders, just not in the chosen face.
            loaded.delete(id);
          },
        ),
      );
    }
  }

  await Promise.all(pending);
}

/** The CSS font shorthand for a text style. */
export function fontShorthand(
  family: string,
  size: number,
  bold: boolean,
  italic: boolean,
): string {
  const definition = FONTS.find((font) => font.family === family);
  const weight = bold && definition?.weights.includes(700) ? 700 : (definition?.weights[0] ?? 400);
  const style = italic && definition?.italic ? 'italic' : 'normal';
  return `${style} ${weight} ${size}px "${family}", sans-serif`;
}
