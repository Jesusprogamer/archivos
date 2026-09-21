import {
  Copy,
  Magnet,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { downloadBlob } from '../../core/convert/zip';
import { useLibrary } from '../../core/media/library';
import type { MediaItem } from '../../core/media/types';
import { VideoEditor } from '../../core/video/editor';
import { loadFonts } from '../../core/video/fonts';
import { listSavedProjects, applySourceMapping, rebindSources, type SavedProject } from '../../core/video/autosave';
import { projectDuration, type TrackKind } from '../../core/video/project';
import { SourceManager } from '../../core/video/sources';
import { baseName, formatTimecode, safeFileName } from '../../core/util/format';
import { useT } from '../../i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Notice } from '../../ui/Notice';
import { Spinner } from '../../ui/Progress';
import { cx } from '../../ui/cx';
import { toast } from '../../ui/toast';
import panel from '../../app/Panel.module.css';
import { ExportPanel } from './ExportPanel';
import { PreviewPlayer } from './PreviewPlayer';
import { Properties } from './Properties';
import { Timeline } from './Timeline';
import styles from './Video.module.css';

type PanelTab = 'properties' | 'media' | 'export';

/** Sets up sources and the project, then hands over to the editor proper. */
export function VideoWorkspace({ item }: { item: MediaItem }) {
  const t = useT();
  const items = useLibrary((state) => state.items);
  const [sources] = useState(() => new SourceManager());
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | undefined>();
  const [editor] = useState(() => new VideoEditor());
  // Read once on mount: the offer to restore only makes sense at the start of a
  // session, and re-reading storage as the library changes would resurrect an
  // offer the user has already turned down.
  const [savedCandidate] = useState<SavedProject | undefined>(() => listSavedProjects()[0]);
  const [restoreDismissed, setRestoreDismissed] = useState(false);

  // Load the fonts once: a text layer that renders in the wrong face for a
  // frame and then jumps looks broken.
  useEffect(() => {
    void loadFonts();
  }, []);

  useEffect(() => () => sources.dispose(), [sources]);
  useEffect(() => () => editor.dispose(), [editor]);

  // The dropped file seeds the project; the rest of the library is available
  // from the media panel.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const source = await sources.load(item);
        if (cancelled) return;
        const track = editor.ensureTrack('video', 'V1');
        if (editor.getProject().tracks.every((candidate) => candidate.clips.length === 0)) {
          const duration = Number.isFinite(source.duration) && source.duration > 0 ? source.duration : 5;
          editor.addMediaClip(track.id, item.id, item.format.kind === 'image' ? 'image' : 'video', duration, 0);
        }
        setReady(true);
      } catch (error) {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editor, item, sources]);

  // Only offer a restore whose files are all still in the library. Derived
  // during render rather than stored, so it follows the library automatically.
  const fingerprints = items.map((entry) => ({
    id: entry.id,
    name: entry.name,
    size: entry.size,
  }));
  const saved =
    !restoreDismissed &&
    savedCandidate &&
    savedCandidate.project.tracks.some((track) => track.clips.length > 0) &&
    rebindSources(savedCandidate, fingerprints).missing.length === 0
      ? savedCandidate
      : undefined;

  useEffect(() => {
    editor.setFingerprints(
      items.map((entry) => ({ sourceId: entry.id, name: entry.name, size: entry.size })),
    );
  }, [editor, items]);

  if (failure) {
    return (
      <EmptyState
        title={t('video.sourceFailed', { name: item.name })}
        body={t('video.sourceFailedHelp')}
        action={<p style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)' }}>{failure}</p>}
      />
    );
  }
  if (!ready) {
    return <EmptyState icon={<Spinner size={26} />} title={t('video.loadingSources')} />;
  }

  return (
    <Editor
      editor={editor}
      sources={sources}
      item={item}
      saved={saved}
      onDismissSaved={() => setRestoreDismissed(true)}
    />
  );
}

function Editor({
  editor,
  sources,
  item,
  saved,
  onDismissSaved,
}: {
  editor: VideoEditor;
  sources: SourceManager;
  item: MediaItem;
  saved: SavedProject | undefined;
  onDismissSaved: () => void;
}) {
  const t = useT();
  const items = useLibrary((state) => state.items);
  useSyncExternalStore(editor.subscribe, editor.getSnapshot, editor.getSnapshot);

  const [player] = useState(() => new PreviewPlayer());
  useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoom, setZoom] = useState(0.35);
  const [tab, setTab] = useState<PanelTab>('properties');

  const project = editor.getProject();
  const duration = projectDuration(project);

  useEffect(() => () => player.dispose(), [player]);

  // Keep the preview canvas attached and redraw whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A half-size preview is plenty on screen and halves the compositing cost.
    const scale = 0.5;
    canvas.width = Math.round(project.width * scale);
    canvas.height = Math.round(project.height * scale);
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return;
    player.attach(context, project, sources, scale);
    player.draw();
  }, [player, project, sources]);

  const sourceDurations = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of items) {
      const source = sources.get(entry.id);
      if (source && Number.isFinite(source.duration)) map.set(entry.id, source.duration);
    }
    return map;
  }, [items, sources]);

  const sourceNames = useMemo(
    () => new Map(items.map((entry) => [entry.id, entry.name])),
    [items],
  );

  const seek = useCallback(
    (time: number) => {
      editor.setPlayhead(time);
      void player.seek(time);
    },
    [editor, player],
  );

  // Keyboard shortcuts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const node = event.target as HTMLElement | null;
      if (node?.closest('input, textarea, select, [contenteditable]')) return;
      const mod = event.metaKey || event.ctrlKey;

      if (event.code === 'Space') {
        event.preventDefault();
        player.toggle();
      } else if (mod && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        editor.undo();
      } else if (mod && (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey))) {
        event.preventDefault();
        editor.redo();
      } else if (event.key.toLowerCase() === 's' && !mod) {
        editor.splitAtPlayhead();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        if (editor.selectedId) editor.removeClip(editor.selectedId);
      } else if (mod && event.key.toLowerCase() === 'd' && editor.selectedId) {
        event.preventDefault();
        editor.duplicateClip(editor.selectedId);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [editor, player]);

  /**
   * Decodes every clip's audio before an export, once per source.
   *
   * Not memoised: it runs on a button press, never during render, and the
   * cache that makes it cheap lives in the source manager anyway.
   */
  const prepareAudio = async (): Promise<void> => {
    const needed = new Set<string>();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if ('sourceId' in clip && clip.kind !== 'image') needed.add(clip.sourceId);
      }
    }
    for (const sourceId of needed) {
      const entry = items.find((candidate) => candidate.id === sourceId);
      if (entry) await sources.audioOf(entry);
    }
  };

  const addToTimeline = (entry: MediaItem, kind: TrackKind) => {
    void (async () => {
      try {
        const source = await sources.load(entry);
        const track = editor.ensureTrack(kind, kind === 'audio' ? 'A1' : 'V1');
        const duration_ =
          Number.isFinite(source.duration) && source.duration > 0 ? source.duration : 5;
        editor.addMediaClip(
          track.id,
          entry.id,
          kind === 'audio' ? 'audio' : entry.format.kind === 'image' ? 'image' : 'video',
          duration_,
        );
      } catch (error) {
        toast.error(t('video.sourceFailed', { name: entry.name }), String(error));
      }
    })();
  };

  const selected = editor.selectedClip;

  return (
    <div className={styles.workspace}>
      <div className={styles.stage}>
        <div className={styles.previewArea}>
          <canvas ref={canvasRef} className={styles.previewCanvas} aria-label={t('video.preview')} />
        </div>

        <div className={styles.transport}>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('audio.toStart')} onClick={() => seek(0)}>
            <SkipBack size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconOnly
            aria-label={player.isPlaying ? t('audio.pause') : t('audio.play')}
            onClick={() => player.toggle()}
          >
            {player.isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
          </Button>
          <span className={styles.time}>
            <span className={styles.timeCurrent}>{formatTimecode(player.currentTime)}</span>
            {' / '}
            {formatTimecode(duration)}
          </span>

          <span className={styles.spacer} />

          <Button variant="ghost" size="sm" iconOnly aria-label={t('common.undo')} disabled={!editor.canUndo} onClick={() => editor.undo()}>
            <Undo2 size={15} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('common.redo')} disabled={!editor.canRedo} onClick={() => editor.redo()}>
            <Redo2 size={15} aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className={styles.timeline}>
        <div className={styles.timelineToolbar}>
          <Button size="sm" disabled={!selected} onClick={() => editor.splitAtPlayhead()}>
            <Scissors size={13} aria-hidden="true" />
            {t('video.split')}
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => selected && editor.duplicateClip(selected.id)}
          >
            <Copy size={13} aria-hidden="true" />
            {t('video.duplicate')}
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => selected && editor.removeClip(selected.id)}
          >
            <Trash2 size={13} aria-hidden="true" />
            {t('video.delete')}
          </Button>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => selected && editor.rippleDelete(selected.id)}
          >
            {t('video.rippleDelete')}
          </Button>

          <span className={styles.spacer} />

          <Button
            size="sm"
            onClick={() => {
              const track = editor.ensureTrack('text', 'T1');
              editor.addTextClip(track.id);
            }}
          >
            <Type size={13} aria-hidden="true" />
            {t('video.addText')}
          </Button>
          <Button size="sm" onClick={() => editor.addTrack('video', `V${project.tracks.length + 1}`)}>
            <Plus size={13} aria-hidden="true" />
            {t('video.addVideoTrack')}
          </Button>
          <Button size="sm" onClick={() => editor.addTrack('audio', `A${project.tracks.length + 1}`)}>
            <Plus size={13} aria-hidden="true" />
            {t('video.addAudioTrack')}
          </Button>

          <Button
            size="sm"
            iconOnly
            pressed={editor.snapping}
            aria-label={t('video.snap')}
            onClick={() => editor.setSnapping(!editor.snapping)}
          >
            <Magnet size={14} aria-hidden="true" />
          </Button>
          <Button size="sm" iconOnly aria-label={t('audio.zoomOut')} onClick={() => setZoom((z) => Math.max(0, z - 0.08))}>
            <ZoomOut size={14} aria-hidden="true" />
          </Button>
          <Button size="sm" iconOnly aria-label={t('audio.zoomIn')} onClick={() => setZoom((z) => Math.min(1, z + 0.08))}>
            <ZoomIn size={14} aria-hidden="true" />
          </Button>
        </div>

        <Timeline
          editor={editor}
          zoom={zoom}
          sourceDurations={sourceDurations}
          sourceNames={sourceNames}
          onSeek={seek}
        />
      </div>

      <aside className={styles.panel} aria-label={t('video.properties')}>
        <div className={styles.panelTabs}>
          {(
            [
              ['properties', t('video.properties')],
              ['media', t('library.title')],
              ['export', t('video.exportTab')],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={styles.panelTab}
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.panelBody}>
          {saved ? (
            <Notice tone="info">
              <strong>{t('video.restore')}</strong>
              <p style={{ marginTop: 4 }}>
                {t('video.restoreHint', { when: new Date(saved.savedAt).toLocaleString() })}
              </p>
              <div className={cx(styles.pair, panel.spaced)}>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    const { mapping } = rebindSources(
                      saved,
                      items.map((entry) => ({ id: entry.id, name: entry.name, size: entry.size })),
                    );
                    editor.load(applySourceMapping(saved.project, mapping));
                    onDismissSaved();
                  }}
                >
                  {t('common.continue')}
                </Button>
                <Button size="sm" variant="ghost" onClick={onDismissSaved}>
                  {t('video.discardSaved')}
                </Button>
              </div>
            </Notice>
          ) : null}

          {tab === 'properties' ? <Properties editor={editor} /> : null}

          {tab === 'media' ? (
            <section className={styles.group}>
              <h3 className={panel.sectionTitle}>{t('video.addFromLibrary')}</h3>
              <ul className={styles.mediaList}>
                {items.map((entry) => (
                  <li key={entry.id} className={styles.mediaRow}>
                    <span className={styles.mediaName} title={entry.name}>
                      {entry.name}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`${t('video.addFromLibrary')}: ${entry.name}`}
                      onClick={() =>
                        addToTimeline(entry, entry.format.kind === 'audio' ? 'audio' : 'video')
                      }
                    >
                      <Plus size={13} aria-hidden="true" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {tab === 'export' ? (
            <ExportPanel
              editor={editor}
              sources={sources}
              audioLookup={(sourceId) => sources.audioFor(sourceId)}
              prepareAudio={prepareAudio}
              onExported={(blob, extension) => {
                downloadBlob(blob, safeFileName(`${baseName(item.name)}-forja.${extension}`));
              }}
            />
          ) : null}
        </div>
      </aside>
    </div>
  );
}
