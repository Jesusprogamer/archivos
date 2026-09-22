import { useRef } from 'react';
import {
  VISUAL_STYLES,
  type AspectId,
  type BackgroundSettings,
  type LogoLayer,
  type TextLayer,
  type VisualStyle,
  type VisualizerScene,
} from '../../core/visualizer/scene';
import { FONTS } from '../../core/video/fonts';
import { useT, type TranslationKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { ColorInput } from '../../ui/ColorInput';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { Switch } from '../../ui/Switch';
import panel from '../../app/Panel.module.css';
import styles from './Visualizer.module.css';

const STYLE_LABEL: Record<VisualStyle, TranslationKey> = {
  bars: 'vis.style.bars',
  mirrorBars: 'vis.style.mirrorBars',
  waveLine: 'vis.style.waveLine',
  radial: 'vis.style.radial',
  area: 'vis.style.area',
  particles: 'vis.style.particles',
};

export interface SceneControlsProps {
  scene: VisualizerScene;
  onChange: (scene: VisualizerScene) => void;
  onBackgroundImage: (file: File) => void;
  onLogoImage: (file: File) => void;
}

export function SceneControls({
  scene,
  onChange,
  onBackgroundImage,
  onLogoImage,
}: SceneControlsProps) {
  const t = useT();
  const backgroundInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);

  const visual = (changes: Partial<VisualizerScene['visual']>) =>
    onChange({ ...scene, visual: { ...scene.visual, ...changes } });
  const background = (changes: Partial<BackgroundSettings>) =>
    onChange({ ...scene, background: { ...scene.background, ...changes } });
  const text = (changes: Partial<TextLayer>) =>
    onChange({ ...scene, text: { ...scene.text, ...changes } });
  const logo = (changes: Partial<LogoLayer>) =>
    onChange({ ...scene, logo: { ...scene.logo, ...changes } });

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    apply: (next: number) => void,
    suffix?: string,
  ) => (
    <Field label={label} key={label}>
      {(id) => (
        <Slider
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          {...(suffix ? { suffix } : {})}
          onChange={apply}
        />
      )}
    </Field>
  );

  return (
    <>
      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.style')}</h3>
        <div className={styles.styleGrid}>
          {VISUAL_STYLES.map((style) => (
            <button
              key={style}
              type="button"
              className={styles.styleButton}
              aria-pressed={scene.visual.style === style}
              onClick={() => visual({ style })}
            >
              {t(STYLE_LABEL[style])}
            </button>
          ))}
        </div>
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.look')}</h3>
        <div className={styles.pair}>
          <Field label={t('vis.colorFrom')}>
            {(id) => (
              <ColorInput
                id={id}
                label={t('vis.colorFrom')}
                swatchOnly
                value={scene.visual.colorFrom}
                onChange={(colorFrom) => visual({ colorFrom })}
              />
            )}
          </Field>
          <Field label={t('vis.colorTo')}>
            {(id) => (
              <ColorInput
                id={id}
                label={t('vis.colorTo')}
                swatchOnly
                value={scene.visual.colorTo}
                onChange={(colorTo) => visual({ colorTo })}
              />
            )}
          </Field>
        </div>
        <Switch
          label={t('vis.gradientAcross')}
          checked={scene.visual.gradientAcross}
          onChange={(gradientAcross) => visual({ gradientAcross })}
        />
        {slider(t('vis.bars'), scene.visual.bars, 8, 160, 1, (bars) => visual({ bars }))}
        {slider(
          t('vis.thickness'),
          scene.visual.thickness,
          1,
          40,
          1,
          (thickness) => visual({ thickness }),
          'px',
        )}
        {slider(t('vis.visualHeight'), scene.visual.height, 0.1, 0.9, 0.01, (height) =>
          visual({ height }),
        )}
        {slider(
          t('vis.sensitivity'),
          scene.visual.sensitivity,
          0.2,
          4,
          0.05,
          (sensitivity) => visual({ sensitivity }),
          '×',
        )}
        {slider(t('vis.smoothing'), scene.visual.smoothing, 0, 0.95, 0.05, (smoothing) =>
          visual({ smoothing }),
        )}
        {slider(t('vis.glow'), scene.visual.glow, 0, 1, 0.05, (glow) => visual({ glow }))}
        {slider(t('vis.bassReaction'), scene.visual.bassReaction, 0, 1, 0.05, (bassReaction) =>
          visual({ bassReaction }),
        )}
        <Switch
          label={t('vis.symmetry')}
          checked={scene.visual.symmetry}
          onChange={(symmetry) => visual({ symmetry })}
        />
        {slider(
          t('vis.minFrequency'),
          scene.visual.minFrequency,
          20,
          500,
          5,
          (minFrequency) => visual({ minFrequency }),
          'Hz',
        )}
        {slider(
          t('vis.maxFrequency'),
          scene.visual.maxFrequency,
          2000,
          20000,
          100,
          (maxFrequency) => visual({ maxFrequency }),
          'Hz',
        )}
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.background')}</h3>
        <SegmentedControl<BackgroundSettings['kind']>
          block
          value={scene.background.kind}
          label={t('vis.background')}
          onChange={(kind) => {
            if (kind === 'image') backgroundInput.current?.click();
            else background({ kind });
          }}
          segments={[
            { value: 'color', label: t('vis.background.color') },
            { value: 'gradient', label: t('vis.background.gradient') },
            { value: 'image', label: t('vis.background.image') },
            { value: 'transparent', label: t('vis.background.transparent') },
          ]}
        />
        {scene.background.kind === 'transparent' ? (
          <Notice tone="info">{t('vis.background.transparentHelp')}</Notice>
        ) : null}
        <div
          className={styles.pair}
          hidden={scene.background.kind === 'transparent'}
        >
          <Field label={t('vis.background.color')}>
            {(id) => (
              <ColorInput
                id={id}
                label={t('vis.background.color')}
                swatchOnly
                value={scene.background.color}
                onChange={(color) => background({ color })}
              />
            )}
          </Field>
          {scene.background.kind === 'gradient' ? (
            <Field label={t('vis.colorTo')}>
              {(id) => (
                <ColorInput
                  id={id}
                  label={t('vis.colorTo')}
                  swatchOnly
                  value={scene.background.gradientTo}
                  onChange={(gradientTo) => background({ gradientTo })}
                />
              )}
            </Field>
          ) : null}
        </div>
        {scene.background.kind === 'gradient'
          ? slider(
              t('vis.background.angle'),
              scene.background.gradientAngle,
              0,
              360,
              5,
              (gradientAngle) => background({ gradientAngle }),
              '°',
            )
          : null}
        {scene.background.kind === 'image' ? (
          <Button variant="secondary" block onClick={() => backgroundInput.current?.click()}>
            {scene.background.imageName || t('vis.background.chooseImage')}
          </Button>
        ) : null}
        {slider(t('vis.background.dim'), scene.background.dim, 0, 0.9, 0.05, (dim) =>
          background({ dim }),
        )}
        <input
          ref={backgroundInput}
          type="file"
          accept="image/*"
          className="file-trigger"
          tabIndex={-1}
          aria-label={t('vis.background.chooseImage')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onBackgroundImage(file);
            event.target.value = '';
          }}
        />
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.text')}</h3>
        <Switch
          label={t('vis.text.show')}
          checked={scene.text.show}
          onChange={(show) => text({ show })}
        />
        {scene.text.show ? (
          <>
            <Field label={t('vis.text.titleField')}>
              {(id) => (
                <input
                  id={id}
                  className="forja-input"
                  value={scene.text.title}
                  onChange={(event) => text({ title: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('vis.text.artistField')}>
              {(id) => (
                <input
                  id={id}
                  className="forja-input"
                  value={scene.text.artist}
                  onChange={(event) => text({ artist: event.target.value })}
                />
              )}
            </Field>
            <Field label={t('video.text.font')} inline>
              {(id) => (
                <Select
                  id={id}
                  value={scene.text.fontFamily}
                  onChange={(fontFamily) => text({ fontFamily })}
                  options={FONTS.map((font) => ({ value: font.family, label: font.label }))}
                />
              )}
            </Field>
            <Field label={t('vis.text.position')} inline>
              {(id) => (
                <Select<TextLayer['position']>
                  id={id}
                  value={scene.text.position}
                  onChange={(position) => text({ position })}
                  options={[
                    { value: 'top', label: t('vis.text.top') },
                    { value: 'center', label: t('vis.text.center') },
                    { value: 'bottom', label: t('vis.text.bottom') },
                  ]}
                />
              )}
            </Field>
            <Field label={t('video.text.color')} inline>
              {(id) => (
                <ColorInput
                  id={id}
                  label={t('video.text.color')}
                  value={scene.text.color}
                  onChange={(color) => text({ color })}
                />
              )}
            </Field>
            {slider(t('video.text.size'), scene.text.size, 0.02, 0.2, 0.005, (size) =>
              text({ size }),
            )}
          </>
        ) : null}
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.logo')}</h3>
        <Switch
          label={t('vis.logo.show')}
          checked={scene.logo.show}
          onChange={(show) => {
            logo({ show });
            if (show && !scene.logo.name) logoInput.current?.click();
          }}
        />
        {scene.logo.show ? (
          <>
            <Button variant="secondary" block onClick={() => logoInput.current?.click()}>
              {scene.logo.name || t('vis.logo.choose')}
            </Button>
            <Field label={t('vis.logo.position')} inline>
              {(id) => (
                <Select<LogoLayer['position']>
                  id={id}
                  value={scene.logo.position}
                  onChange={(position) => logo({ position })}
                  options={[
                    { value: 'topLeft', label: t('vis.logo.topLeft') },
                    { value: 'topRight', label: t('vis.logo.topRight') },
                    { value: 'bottomLeft', label: t('vis.logo.bottomLeft') },
                    { value: 'bottomRight', label: t('vis.logo.bottomRight') },
                    { value: 'center', label: t('vis.logo.center') },
                  ]}
                />
              )}
            </Field>
            {slider(t('vis.logo.size'), scene.logo.size, 0.04, 0.5, 0.01, (size) => logo({ size }))}
            {slider(t('vis.logo.opacity'), scene.logo.opacity, 0.1, 1, 0.05, (opacity) =>
              logo({ opacity }),
            )}
          </>
        ) : null}
        <input
          ref={logoInput}
          type="file"
          accept="image/*"
          className="file-trigger"
          tabIndex={-1}
          aria-label={t('vis.logo.choose')}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onLogoImage(file);
            event.target.value = '';
          }}
        />
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('vis.format')}</h3>
        <Field label={t('vis.aspect')} inline>
          {(id) => (
            <Select<AspectId>
              id={id}
              value={scene.aspect}
              onChange={(aspect) => onChange({ ...scene, aspect })}
              options={[
                { value: '16:9', label: '16:9' },
                { value: '9:16', label: '9:16' },
                { value: '1:1', label: '1:1' },
                { value: '4:5', label: '4:5' },
              ]}
            />
          )}
        </Field>
        <Field label={t('vis.resolution')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(scene.height)}
              onChange={(next) => onChange({ ...scene, height: Number(next) })}
              options={[
                { value: '1080', label: '1080p' },
                { value: '720', label: '720p' },
                { value: '480', label: '480p' },
              ]}
            />
          )}
        </Field>
        <Field label={t('video.fps')} inline>
          {(id) => (
            <Select
              id={id}
              value={String(scene.fps)}
              onChange={(next) => onChange({ ...scene, fps: Number(next) })}
              options={[
                { value: '60', label: '60' },
                { value: '30', label: '30' },
                { value: '25', label: '25' },
                { value: '24', label: '24' },
              ]}
            />
          )}
        </Field>
        <Notice tone="info">{t('vis.analysisNote')}</Notice>
      </section>
    </>
  );
}
