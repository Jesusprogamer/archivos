import { Download, Package, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_OPTIONS, type ConversionOptions } from '../../core/convert/options';
import { estimateRemaining, useQueue, type Job } from '../../core/convert/queue';
import { targetById, targetsFor, type Target } from '../../core/convert/targets';
import { createZip, downloadBlob } from '../../core/convert/zip';
import { ffmpeg } from '../../core/ffmpeg/client';
import { useLibrary } from '../../core/media/library';
import type { MediaItem } from '../../core/media/types';
import { canvasEncodeSupport } from '../../core/util/capabilities';
import { formatBytes, formatDuration } from '../../core/util/format';
import { useLocaleStore, useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { Notice } from '../../ui/Notice';
import { Progress } from '../../ui/Progress';
import { cx } from '../../ui/cx';
import { toast } from '../../ui/toast';
import { Inspector } from '../../app/Inspector';
import panel from '../../app/Panel.module.css';
import { SizeGuard } from '../../app/SizeGuard';
import { worstVerdict } from '../../core/media/sizeGuard';
import { OutputOptions } from './OutputOptions';
import styles from './Convert.module.css';

const STATUS_KEY = {
  queued: 'convert.status.queued',
  running: 'convert.status.running',
  done: 'convert.status.done',
  error: 'convert.status.error',
  cancelled: 'convert.status.cancelled',
} as const;

function JobRow({ job }: { job: Job }) {
  const t = useT();
  const cancel = useQueue((state) => state.cancel);
  const remove = useQueue((state) => state.remove);
  const [, force] = useState(0);

  // The estimate is derived from elapsed time, so the row needs a heartbeat.
  useEffect(() => {
    if (job.status !== 'running') return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [job.status]);

  const remaining = estimateRemaining(job);
  const active = job.status === 'queued' || job.status === 'running';

  return (
    <li className={styles.job}>
      <span className={styles.jobHead}>
        <span className={styles.jobName} title={job.outputName}>
          {job.outputName}
        </span>
        <span
          className={cx(
            styles.jobStatus,
            job.status === 'done' && styles.statusDone,
            job.status === 'error' && styles.statusError,
          )}
        >
          {t(STATUS_KEY[job.status])}
          {job.result ? ` · ${formatBytes(job.result.blob.size)}` : ''}
        </span>
      </span>

      <span className={styles.jobActions}>
        {job.status === 'done' && job.result ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => downloadBlob(job.result!.blob, job.result!.fileName)}
          >
            <Download size={13} aria-hidden="true" />
            {t('common.download')}
          </Button>
        ) : null}
        {active ? (
          <Button size="sm" variant="ghost" onClick={() => cancel(job.id)}>
            {t('common.cancel')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            aria-label={t('common.remove')}
            onClick={() => remove(job.id)}
          >
            <X size={14} aria-hidden="true" />
          </Button>
        )}
      </span>

      {job.status === 'running' ? (
        <span className={styles.jobProgress}>
          <Progress
            value={job.progress}
            {...(remaining !== undefined
              ? { detail: t('convert.eta', { time: formatDuration(remaining) }) }
              : {})}
          />
        </span>
      ) : null}

      {job.error ? <span className={styles.jobError}>{job.error}</span> : null}
    </li>
  );
}

function EngineLoading() {
  const t = useT();
  const [progress, setProgress] = useState<{ received: number; total: number } | undefined>();

  useEffect(() => ffmpeg.onLoadProgress(setProgress), []);

  if (!progress || ffmpeg.loaded) return null;
  return (
    <div className={styles.loading}>
      <Progress
        value={progress.total > 0 ? progress.received / progress.total : undefined}
        label={t('convert.loadingCore', { size: formatBytes(progress.total) })}
      />
      <p style={{ fontSize: 'var(--text-2xs)', color: 'var(--fg-muted)' }}>
        {t('convert.loadingCoreHint')}
      </p>
    </div>
  );
}

export function ConvertWorkspace({ item }: { item: MediaItem }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const items = useLibrary((state) => state.items);
  const jobs = useQueue((state) => state.jobs);
  const enqueue = useQueue((state) => state.enqueue);
  const cancelAll = useQueue((state) => state.cancelAll);
  const clearFinished = useQueue((state) => state.clearFinished);

  // Only files the current target can accept. Computed before state so the
  // initial selection can cover the whole batch.
  const eligible = items.filter((candidate) => candidate.format.kind === item.format.kind);

  const [canvasTypes, setCanvasTypes] = useState<ReadonlySet<string> | undefined>();
  const [options, setOptions] = useState<ConversionOptions>(DEFAULT_OPTIONS);
  const [targetId, setTargetId] = useState<string | undefined>();
  // Converting is a batch tool, so everything compatible starts selected.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(eligible.map((candidate) => candidate.id)),
  );
  const [known, setKnown] = useState<ReadonlySet<string>>(
    () => new Set(eligible.map((candidate) => candidate.id)),
  );
  const [zipping, setZipping] = useState(false);
  const [pendingBatch, setPendingBatch] = useState<readonly MediaItem[] | undefined>();

  // Files added later join the batch; ones the user unticked stay unticked.
  // Adjusted during render rather than in an effect, so the list is never
  // painted in the stale state first.
  const fresh = eligible.filter((candidate) => !known.has(candidate.id));
  if (fresh.length > 0) {
    setKnown(new Set([...known, ...fresh.map((candidate) => candidate.id)]));
    setSelected(new Set([...selected, ...fresh.map((candidate) => candidate.id)]));
  }

  useEffect(() => {
    void canvasEncodeSupport().then(setCanvasTypes);
  }, []);

  const targets = useMemo(
    () => targetsFor(item.format, canvasTypes),
    [item.format, canvasTypes],
  );

  const target: Target | undefined = targetId
    ? targetById(targetId)
    : targets.find((candidate) => candidate.id !== item.format.id) ?? targets[0];

  const chosen = eligible.filter((candidate) => selected.has(candidate.id));
  const finished = jobs.filter((job) => job.status === 'done' && job.result);
  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running');

  const startConversion = (batch: readonly MediaItem[]) => {
    if (target) enqueue(batch, target, options);
    setPendingBatch(undefined);
  };

  /** Large files get a word of warning before the wait, not after the crash. */
  const requestConversion = () => {
    if (!target || chosen.length === 0) return;
    if (worstVerdict(chosen).verdict === 'ok') startConversion(chosen);
    else setPendingBatch(chosen);
  };

  const downloadZip = async () => {
    setZipping(true);
    try {
      const blob = await createZip(
        finished.map((job) => ({ name: job.result!.fileName, blob: job.result!.blob })),
      );
      downloadBlob(blob, 'forja.zip');
    } catch (error) {
      toast.error(t('error.generic'), error instanceof Error ? error.message : String(error));
    } finally {
      setZipping(false);
    }
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.queueArea} aria-label={t('convert.queue')}>
        <div className={styles.queueHead}>
          <h2 className={styles.queueTitle}>
            {jobs.length === 0 ? item.name : t('convert.queue')}
          </h2>
          {finished.length > 1 ? (
            <Button size="sm" variant="secondary" disabled={zipping} onClick={() => void downloadZip()}>
              <Package size={13} aria-hidden="true" />
              {t('convert.downloadZip')}
            </Button>
          ) : null}
          {active ? (
            <Button size="sm" variant="ghost" onClick={cancelAll}>
              {t('convert.cancelAll')}
            </Button>
          ) : null}
          {jobs.length > finished.length + (active ? 1 : 0) || finished.length > 0 ? (
            <Button
              size="sm"
              variant="ghost"
              iconOnly
              aria-label={t('convert.clearFinished')}
              onClick={clearFinished}
            >
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          ) : null}
        </div>

        {jobs.length === 0 ? (
          // Nothing queued yet, so the space shows what is about to be
          // converted rather than an empty box.
          <Inspector item={item} />
        ) : (
          <ul className={styles.jobs}>
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>

      <aside className={styles.panel} aria-label={t('convert.options')}>
        <div className={styles.panelBody}>
          <EngineLoading />

          <section>
            <h3 className={panel.sectionTitle}>{t('convert.outputFormat')}</h3>
            <div className={styles.formatGrid}>
              {targets.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={styles.formatButton}
                  aria-pressed={candidate.id === target?.id}
                  onClick={() => setTargetId(candidate.id)}
                >
                  {candidate.id === 'mp4-h265' ? 'H.265' : candidate.format.label.split(' ')[0]}
                  <span className={styles.formatKind}>
                    {candidate.outputKind === 'audio' && item.format.kind === 'video'
                      ? t('file.audio')
                      : `.${candidate.extension}`}
                  </span>
                </button>
              ))}
            </div>
            {target?.caveat ? (
              <Notice tone="warning" className={cx(panel.spaced)}>
                {t(`convert.caveat.${target.caveat}` as const)}
              </Notice>
            ) : null}
            {target && target.format.id === item.format.id && target.outputKind !== 'audio' ? (
              <Notice tone="info" className={cx(panel.spaced)}>
                {t('convert.sameFormat')}
              </Notice>
            ) : null}
          </section>

          {target ? (
            <section>
              <h3 className={panel.sectionTitle}>{t('convert.options')}</h3>
              <OutputOptions target={target} options={options} onChange={setOptions} />
            </section>
          ) : null}

          <section>
            <h3 className={panel.sectionTitle}>{t('convert.files')}</h3>
            <ul className={styles.fileList}>
              {eligible.map((candidate) => (
                <li key={candidate.id}>
                  <label className={styles.fileRow}>
                    <input
                      type="checkbox"
                      checked={selected.has(candidate.id)}
                      onChange={(event) => {
                        const next = new Set(selected);
                        if (event.target.checked) next.add(candidate.id);
                        else next.delete(candidate.id);
                        setSelected(next);
                      }}
                    />
                    <span className={styles.fileRowName} title={candidate.name}>
                      {candidate.name}
                    </span>
                    <span className={styles.fileRowSize}>
                      {formatBytes(candidate.size, locale)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className={styles.panelFoot}>
          <Button
            variant="primary"
            size="lg"
            block
            disabled={!target || chosen.length === 0}
            onClick={requestConversion}
          >
            {chosen.length > 1 ? t('convert.startN', { n: chosen.length }) : t('convert.start')}
          </Button>
        </div>
      </aside>

      <SizeGuard
        pending={pendingBatch}
        onCancel={() => setPendingBatch(undefined)}
        onConfirm={() => {
          if (pendingBatch) startConversion(pendingBatch);
        }}
      />
    </div>
  );
}
