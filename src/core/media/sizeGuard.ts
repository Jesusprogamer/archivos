import { SIZE_BLOCK_BYTES, sizeVerdict, type SizeVerdict } from '../media/library';
import type { MediaItem } from '../media/types';

/**
 * The heaviest file in a batch decides the warning, since that is the one that
 * will exhaust memory first.
 */
export function worstVerdict(items: readonly MediaItem[]): {
  verdict: SizeVerdict;
  item: MediaItem | undefined;
} {
  let worst: MediaItem | undefined;
  for (const item of items) {
    if (!worst || item.size > worst.size) worst = item;
  }
  return { verdict: worst ? sizeVerdict(worst.size) : 'ok', item: worst };
}

export { SIZE_BLOCK_BYTES };
