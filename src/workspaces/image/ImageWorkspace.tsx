import {
  Brush,
  Crop as CropIcon,
  Download,
  Hand,
  Image as ImageIcon,
  Maximize,
  Pipette,
  Redo2,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { BrushMode, BrushSettings } from '../../core/image/brush';
import type { ByteArray } from '../../core/image/bytes';
import { sampleColor, type ColorKeyParams } from '../../core/image/colorKey';
import { NEUTRAL_ADJUSTMENTS, adjustmentsFilter, isNeutral, type Adjustments } from '../../core/image/editor';
import { decodeToPixels } from '../../core/image/export';
import { clampCrop, type CropRect } from '../../core/image/transform';
import type { MediaItem } from '../../core/media/types';
import { useT, type TranslationKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { EmptyState } from '../../ui/EmptyState';
import { Notice } from '../../ui/Notice';
import { Spinner } from '../../ui/Progress';
import { NO_BACKDROP, type Backdrop } from './backdrop';
import { ImageCanvas, MAX_ZOOM, MIN_ZOOM, type CanvasMode, type Viewport } from './ImageCanvas';
import { useImageEditor } from './useEditor';
import { AdjustTool } from './tools/AdjustTool';
import { AiTool } from './tools/AiTool';
import { BackdropTool } from './tools/BackdropTool';
import { BrushTool } from './tools/BrushTool';
import { CropOverlay } from './tools/CropOverlay';
import { CropTool } from './tools/CropTool';
import { aspectRatio, centredRect, type AspectId } from './tools/cropGeometry';
import { ColorKeyTool } from './tools/ColorKeyTool';
import { ExportPanel } from './tools/ExportPanel';
import { TransformTool } from './tools/TransformTool';
import styles from './Image.module.css';

type ToolId = 'colorKey' | 'ai' | 'brush' | 'crop' | 'adjust' | 'transform' | 'backdrop' | 'export';

const TOOLS: ReadonlyArray<{ id: ToolId; icon: typeof Brush; labelKey: TranslationKey }> = [
  { id: 'colorKey', icon: Pipette, labelKey: 'image.tool.colorKey' },
  { id: 'ai', icon: Sparkles, labelKey: 'image.tool.ai' },
  { id: 'brush', icon: Brush, labelKey: 'image.tool.brush' },
  { id: 'crop', icon: CropIcon, labelKey: 'image.tool.crop' },
  { id: 'adjust', icon: SlidersHorizontal, labelKey: 'image.tool.adjust' },
  { id: 'transform', icon: RotateCw, labelKey: 'image.tool.transform' },
  { id: 'backdrop', icon: ImageIcon, labelKey: 'image.tool.backdrop' },
  { id: 'export', icon: Download, labelKey: 'image.tool.export' },
];

interface Decoded {
  pixels: ByteArray;
  width: number;
  height: number;
}

export function ImageWorkspace({ item }: { item: MediaItem }) {
  const t = useT();
  const [decoded, setDecoded] = useState<Decoded | undefined>();
  const [decodeError, setDecodeError] = useState<string | undefined>();
  const [decodedFile, setDecodedFile] = useState(item.file);

  // A different file clears the last result immediately, during render, so the
  // previous image never flashes up while the new one decodes.
  if (decodedFile !== item.file) {
    setDecodedFile(item.file);
    setDecoded(undefined);
    setDecodeError(undefined);
  }

  useEffect(() => {
    let cancelled = false;
    void decodeToPixels(item.file).then(
      (result) => {
        if (!cancelled) setDecoded(result);
      },
      (error: unknown) => {
        if (!cancelled) setDecodeError(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.file]);

  if (decodeError) {
    return <EmptyState title={t('image.decodeFailed')} body={decodeError} />;
  }
  if (!decoded) {
    return <EmptyState icon={<Spinner size={26} />} title={t('image.decoding')} />;
  }
  // Keyed on the file so a different image starts a fresh editor and history.
  return <Editor key={item.id} item={item} decoded={decoded} />;
}

function Editor({ item, decoded }: { item: MediaItem; decoded: Decoded }) {
  const t = useT();
  const { editor, version } = useImageEditor(decoded.pixels, decoded.width, decoded.height);
  const state = editor.getState();

  const [tool, setTool] = useState<ToolId>('colorKey');
  const [viewport, setViewport] = useState<Viewport>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [fitRequested, setFitRequested] = useState(true);
  const [backdrop, setBackdrop] = useState<Backdrop>(NO_BACKDROP);
  const [adjustments, setAdjustments] = useState<Adjustments>(NEUTRAL_ADJUSTMENTS);
  const [picking, setPicking] = useState(false);
  const [keyParams, setKeyParams] = useState<ColorKeyParams>({
    color: '#00b140',
    tolerance: 25,
    softness: 15,
    contiguous: false,
  });
  const [brush, setBrush] = useState<BrushSettings>({ size: 48, hardness: 70, opacity: 100 });
  const [brushMode, setBrushMode] = useState<BrushMode>('erase');
  const [aspect, setAspect] = useState<AspectId>('free');
  const [cropRect, setCropRect] = useState<CropRect | undefined>();

  const filter = isNeutral(adjustments) ? 'none' : adjustmentsFilter(adjustments);
  const preview = editor.getPreview();

  /**
   * Fits the picture to the viewport. Driven by the canvas reporting its own
   * size, so it works on first paint and after a window resize alike, without
   * measuring the DOM during render.
   */
  const fitToViewport = useCallback(
    (box: { width: number; height: number }) => {
      if (!fitRequested) return;
      const zoom = Math.min(1, (box.width - 48) / state.width, (box.height - 48) / state.height);
      setViewport({ zoom: Math.max(MIN_ZOOM, zoom), offsetX: 0, offsetY: 0 });
      setFitRequested(false);
    },
    [fitRequested, state.width, state.height],
  );

  // The colour key preview follows its controls, so the picture reacts as the
  // sliders move rather than after a button press.
  useEffect(() => {
    if (tool !== 'colorKey') return;
    if (keyParams.contiguous && !keyParams.seed) {
      editor.clearPreview();
      return;
    }
    editor.previewColorKey(keyParams);
  }, [editor, tool, keyParams]);

  // Leaving the colour tool drops an uncommitted preview rather than leaving a
  // half-applied state hanging around.
  useEffect(() => {
    if (tool !== 'colorKey' && tool !== 'ai') editor.clearPreview();
  }, [editor, tool]);

  // Switching to the crop tool, or changing the ratio, proposes a fresh frame.
  // Derived during render so the overlay is never drawn one frame stale.
  const cropKey = `${tool}:${aspect}:${state.width}x${state.height}`;
  const [lastCropKey, setLastCropKey] = useState(cropKey);
  if (cropKey !== lastCropKey) {
    setLastCropKey(cropKey);
    setCropRect(tool === 'crop' ? centredRect(state.width, state.height, aspectRatio(aspect)) : undefined);
  }

  const mode: CanvasMode =
    picking && tool === 'colorKey'
      ? 'eyedrop'
      : tool === 'brush'
        ? 'brush'
        : tool === 'crop'
          ? 'crop'
          : 'pan';

  const zoomBy = (factor: number) =>
    setViewport((current) => ({
      ...current,
      zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * factor)),
    }));

  return (
    <div className={styles.workspace}>
      <nav className={styles.rail} aria-label={t('image.background')}>
        {TOOLS.map(({ id, icon: Icon, labelKey }, index) => (
          <div key={id} style={{ display: 'contents' }}>
            {index === 3 || index === 7 ? <span className={styles.railSeparator} /> : null}
            <button
              type="button"
              className={styles.railButton}
              aria-pressed={tool === id}
              onClick={() => setTool(id)}
            >
              <Icon size={17} aria-hidden="true" />
              {t(labelKey)}
            </button>
          </div>
        ))}
      </nav>

      <div className={styles.stage}>
        <div className={styles.stageToolbar}>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.undo')}
            disabled={!editor.canUndo}
            onClick={() => editor.undo()}
          >
            <Undo2 size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('common.redo')}
            disabled={!editor.canRedo}
            onClick={() => editor.redo()}
          >
            <Redo2 size={15} aria-hidden="true" />
          </Button>

          <span className={styles.stageSpacer} />

          {preview ? (
            <span className={styles.previewBar}>
              <span>{t('image.previewPending')}</span>
              <Button size="sm" variant="ghost" onClick={() => editor.clearPreview()}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" variant="primary" onClick={() => editor.commitPreview()}>
                {t('common.apply')}
              </Button>
            </span>
          ) : null}

          <span className={styles.stageSpacer} />

          <Button variant="ghost" size="sm" iconOnly aria-label={t('image.view.zoomOut')} onClick={() => zoomBy(1 / 1.25)}>
            <ZoomOut size={15} aria-hidden="true" />
          </Button>
          <span className={styles.zoomValue}>{Math.round(viewport.zoom * 100)}%</span>
          <Button variant="ghost" size="sm" iconOnly aria-label={t('image.view.zoomIn')} onClick={() => zoomBy(1.25)}>
            <ZoomIn size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('image.view.actual')}
            onClick={() => setViewport({ zoom: 1, offsetX: 0, offsetY: 0 })}
          >
            <Maximize size={15} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            aria-label={t('image.view.reset')}
            onClick={() => setFitRequested(true)}
          >
            <Hand size={15} aria-hidden="true" />
          </Button>
        </div>

        <ImageCanvas
          state={state}
          previewMask={preview}
          filter={filter}
          backdrop={backdrop}
          version={version}
          mode={mode}
          brushSize={brush.size}
          viewport={viewport}
          onViewportChange={setViewport}
          onPickColor={(x, y) => {
            setKeyParams((current) => ({
              ...current,
              color: sampleColor(state, x, y),
              seed: { x, y },
            }));
            setPicking(false);
          }}
          onStrokeStart={(x, y, erase) =>
            editor.beginStroke(x, y, brush, erase ? brushMode : invert(brushMode))
          }
          onStrokeMove={(x, y, erase) =>
            editor.continueStroke(x, y, brush, erase ? brushMode : invert(brushMode))
          }
          onStrokeEnd={() => editor.endStroke()}
          onCropDrag={(rect) => setCropRect(clampCrop(rect, state.width, state.height))}
          onViewportResize={fitToViewport}
          overlay={
            tool === 'crop' && cropRect ? (
              <CropOverlay rect={cropRect} imageWidth={state.width} imageHeight={state.height} />
            ) : null
          }
        />
      </div>

      <aside className={styles.panel} aria-label={t(TOOLS.find((entry) => entry.id === tool)!.labelKey)}>
        <div className={styles.panelBody}>
          {tool === 'colorKey' ? (
            <ColorKeyTool
              params={keyParams}
              onChange={setKeyParams}
              picking={picking}
              onPickingChange={setPicking}
            />
          ) : null}

          {tool === 'ai' ? (
            <AiTool
              pixels={state.pixels}
              width={state.width}
              height={state.height}
              onMask={(mask) => editor.previewMask(mask)}
            />
          ) : null}

          {tool === 'brush' ? (
            <BrushTool
              settings={brush}
              onChange={setBrush}
              mode={brushMode}
              onModeChange={setBrushMode}
            />
          ) : null}

          {tool === 'crop' ? (
            <CropTool
              aspect={aspect}
              onAspectChange={setAspect}
              rect={cropRect}
              onApply={() => {
                if (cropRect) editor.crop(cropRect);
                setTool('colorKey');
              }}
            />
          ) : null}

          {tool === 'adjust' ? (
            <>
              <AdjustTool adjustments={adjustments} onChange={setAdjustments} />
              <Button
                variant="primary"
                block
                disabled={isNeutral(adjustments)}
                onClick={() => {
                  editor.applyAdjustments(adjustments);
                  setAdjustments(NEUTRAL_ADJUSTMENTS);
                }}
              >
                {t('common.apply')}
              </Button>
            </>
          ) : null}

          {tool === 'transform' ? (
            <TransformTool
              width={state.width}
              height={state.height}
              onRotate={(turns) => editor.rotateFlip(turns)}
              onFlip={(axis) => editor.rotateFlip(0, axis === 'x', axis === 'y')}
              onResize={(size) => editor.resize(size)}
            />
          ) : null}

          {tool === 'backdrop' ? (
            <BackdropTool backdrop={backdrop} onChange={setBackdrop} />
          ) : null}

          {tool === 'export' ? (
            <ExportPanel
              state={state}
              sourceName={item.name}
              filter={filter}
              backdrop={backdrop}
            />
          ) : null}

          {tool !== 'export' && tool !== 'crop' ? (
            <Button variant="ghost" size="sm" block onClick={() => editor.resetMask()}>
              {t('image.resetMask')}
            </Button>
          ) : null}

          {!isNeutral(adjustments) && tool !== 'adjust' ? (
            <Notice tone="warning">{t('image.adjust.livePreview')}</Notice>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function invert(mode: BrushMode): BrushMode {
  return mode === 'erase' ? 'restore' : 'erase';
}
