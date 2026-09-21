import { SIZE_BLOCK_BYTES, worstVerdict } from '../core/media/sizeGuard';
import type { MediaItem } from '../core/media/types';
import { formatBytes } from '../core/util/format';
import { useLocaleStore, useT } from '../i18n';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';

export interface SizeGuardProps {
  /** The batch about to be processed, or `undefined` when nothing is pending. */
  pending: readonly MediaItem[] | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Warns before a job that is likely to run the browser out of memory.
 *
 * It never refuses outright: the limit is a judgement about typical machines,
 * and the person in front of the screen knows theirs better than we do. What
 * it does is make the risk explicit before the wait, rather than after a crash.
 */
export function SizeGuard({ pending, onConfirm, onCancel }: SizeGuardProps) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const { verdict, item } = worstVerdict(pending ?? []);
  const open = pending !== undefined && verdict !== 'ok' && item !== undefined;

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={verdict === 'block' ? t('size.blockTitle') : t('size.warnTitle')}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant={verdict === 'block' ? 'danger' : 'primary'} onClick={onConfirm}>
            {verdict === 'block' ? t('size.continueAnyway') : t('common.continue')}
          </Button>
        </>
      }
    >
      <p>
        {verdict === 'block'
          ? t('size.blockBody', {
              name: item?.name ?? '',
              size: formatBytes(item?.size ?? 0, locale),
              limit: formatBytes(SIZE_BLOCK_BYTES, locale),
            })
          : t('size.warnBody', {
              name: item?.name ?? '',
              size: formatBytes(item?.size ?? 0, locale),
            })}
      </p>
    </Dialog>
  );
}
