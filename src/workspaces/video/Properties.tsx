import { Diamond, Trash2 } from 'lucide-react';
import type { VideoEditor } from '../../core/video/editor';
import { FONTS } from '../../core/video/fonts';
import {
  isTextClip,
  type Clip,
  type KeyframeProperty,
  type MediaClip,
  type TextAlign,
  type TextAnimation,
  type TextClip,
  type TransitionKind,
} from '../../core/video/project';
import { useT, type TranslationKey } from '../../i18n';
import { Button } from '../../ui/Button';
import { ColorInput } from '../../ui/ColorInput';
import { EmptyState } from '../../ui/EmptyState';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Select } from '../../ui/Select';
import { Slider } from '../../ui/Slider';
import { Switch } from '../../ui/Switch';
import panel from '../../app/Panel.module.css';
import styles from './Video.module.css';

const ANIMATIONS: ReadonlyArray<{ value: TextAnimation; labelKey: TranslationKey }> = [
  { value: 'none', labelKey: 'video.anim.none' },
  { value: 'fade', labelKey: 'video.anim.fade' },
  { value: 'slideUp', labelKey: 'video.anim.slideUp' },
  { value: 'slideLeft', labelKey: 'video.anim.slideLeft' },
  { value: 'zoom', labelKey: 'video.anim.zoom' },
];

/**
 * Adds or replaces a keyframe for a property at the playhead.
 *
 * Replacing rather than appending matters: setting a value twice at the same
 * moment should refine the keyframe, not stack two of them at identical times,
 * which would make the interpolation ambiguous.
 */
function withKeyframe(clip: Clip, property: KeyframeProperty, at: number, value: number): Clip {
  const existing = clip.keyframes[property] ?? [];
  const kept = existing.filter((frame) => Math.abs(frame.at - at) > 1e-3);
  const frames = [...kept, { at, value }].sort((a, b) => a.at - b.at);
  return { ...clip, keyframes: { ...clip.keyframes, [property]: frames } };
}

export function Properties({ editor }: { editor: VideoEditor }) {
  const t = useT();
  const clip = editor.selectedClip;

  if (!clip) return <EmptyState title={t('video.noSelection')} />;

  const update = (changes: Partial<Clip>) => editor.updateClip(clip.id, changes);
  const localTime = Math.max(0, Math.min(clip.duration, editor.playhead - clip.start));

  const keyframeRow = (property: KeyframeProperty, currentValue: number) => {
    const count = clip.keyframes[property]?.length ?? 0;
    return (
      <div className={styles.pair}>
        <Button
          size="sm"
          variant="secondary"
          onClick={() =>
            editor.updateClip(clip.id, withKeyframe(clip, property, localTime, currentValue))
          }
        >
          <Diamond size={12} aria-hidden="true" />
          {count > 0 ? t('video.keyframeCount', { n: count }) : t('video.addKeyframe')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={count === 0}
          aria-label={t('video.clearKeyframes')}
          onClick={() =>
            update({ keyframes: { ...clip.keyframes, [property]: undefined } })
          }
        >
          <Trash2 size={12} aria-hidden="true" />
        </Button>
      </div>
    );
  };

  return (
    <>
      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('video.transform')}</h3>
        <Field label={`${t('video.position')} X`}>
          {(id) => (
            <Slider
              id={id}
              min={-1920}
              max={1920}
              value={clip.transform.x}
              aria-label={`${t('video.position')} X`}
              onChange={(x) => update({ transform: { ...clip.transform, x } })}
            />
          )}
        </Field>
        <Field label={`${t('video.position')} Y`}>
          {(id) => (
            <Slider
              id={id}
              min={-1080}
              max={1080}
              value={clip.transform.y}
              aria-label={`${t('video.position')} Y`}
              onChange={(y) => update({ transform: { ...clip.transform, y } })}
            />
          )}
        </Field>
        <Field label={t('video.scale')}>
          {(id) => (
            <Slider
              id={id}
              min={0.1}
              max={4}
              step={0.01}
              value={clip.transform.scale}
              suffix="×"
              aria-label={t('video.scale')}
              onChange={(scale) => update({ transform: { ...clip.transform, scale } })}
            />
          )}
        </Field>
        {keyframeRow('scale', clip.transform.scale)}
        <Field label={t('video.rotation')}>
          {(id) => (
            <Slider
              id={id}
              min={-180}
              max={180}
              value={clip.transform.rotation}
              suffix="°"
              aria-label={t('video.rotation')}
              onChange={(rotation) => update({ transform: { ...clip.transform, rotation } })}
            />
          )}
        </Field>
        <Field label={t('video.opacity')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={1}
              step={0.01}
              value={clip.transform.opacity}
              aria-label={t('video.opacity')}
              onChange={(opacity) => update({ transform: { ...clip.transform, opacity } })}
            />
          )}
        </Field>
        {keyframeRow('opacity', clip.transform.opacity)}
        <Notice tone="info">{t('video.keyframeHint')}</Notice>
      </section>

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('video.effects')}</h3>
        <Field label={t('video.beatPunch')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={1}
              step={0.05}
              value={clip.beatPunch}
              aria-label={t('video.beatPunch')}
              onChange={(beatPunch) => update({ beatPunch })}
            />
          )}
        </Field>
        <Notice tone="info">{t('video.beatPunchHelp')}</Notice>
      </section>

      {isTextClip(clip) ? <TextProperties clip={clip} editor={editor} /> : null}
      {!isTextClip(clip) ? <MediaProperties clip={clip} editor={editor} /> : null}

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('video.timing')}</h3>
        <Field label={t('video.fadeIn')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={Math.max(0.5, clip.duration / 2)}
              step={0.05}
              value={clip.fadeIn}
              suffix="s"
              aria-label={t('video.fadeIn')}
              onChange={(fadeIn) => update({ fadeIn })}
            />
          )}
        </Field>
        <Field label={t('video.fadeOut')}>
          {(id) => (
            <Slider
              id={id}
              min={0}
              max={Math.max(0.5, clip.duration / 2)}
              step={0.05}
              value={clip.fadeOut}
              suffix="s"
              aria-label={t('video.fadeOut')}
              onChange={(fadeOut) => update({ fadeOut })}
            />
          )}
        </Field>
        <Field label={t('video.transition')} inline>
          {(id) => (
            <Select<TransitionKind>
              id={id}
              value={clip.transition.kind}
              onChange={(kind) =>
                update({
                  transition: {
                    kind,
                    duration: clip.transition.duration > 0 ? clip.transition.duration : 0.5,
                  },
                })
              }
              options={[
                { value: 'none', label: t('video.transition.none') },
                { value: 'crossfade', label: t('video.transition.crossfade') },
                { value: 'fadeToBlack', label: t('video.transition.fadeToBlack') },
              ]}
            />
          )}
        </Field>
        {clip.transition.kind !== 'none' ? (
          <Field label={t('video.transitionDuration')}>
            {(id) => (
              <Slider
                id={id}
                min={0.1}
                max={Math.max(0.5, clip.duration)}
                step={0.05}
                value={clip.transition.duration}
                suffix="s"
                aria-label={t('video.transitionDuration')}
                onChange={(duration) => update({ transition: { ...clip.transition, duration } })}
              />
            )}
          </Field>
        ) : null}
        {clip.transition.kind === 'crossfade' ? (
          <Notice tone="info">{t('video.transitionNeedsOverlap')}</Notice>
        ) : null}
      </section>
    </>
  );
}

function MediaProperties({ clip, editor }: { clip: MediaClip; editor: VideoEditor }) {
  const t = useT();
  const update = (changes: Partial<MediaClip>) => editor.updateClip(clip.id, changes);

  return (
    <>
      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('video.crop')}</h3>
        {(
          [
            ['top', 'video.cropTop'],
            ['right', 'video.cropRight'],
            ['bottom', 'video.cropBottom'],
            ['left', 'video.cropLeft'],
          ] as const
        ).map(([side, labelKey]) => (
          <Field key={side} label={t(labelKey)}>
            {(id) => (
              <Slider
                id={id}
                min={0}
                max={0.45}
                step={0.01}
                value={clip.transform.crop[side]}
                aria-label={t(labelKey)}
                onChange={(value) =>
                  update({
                    transform: {
                      ...clip.transform,
                      crop: { ...clip.transform.crop, [side]: value },
                    },
                  })
                }
              />
            )}
          </Field>
        ))}
      </section>

      {clip.kind === 'image' ? null : (
        <section className={styles.group}>
          <h3 className={panel.sectionTitle}>{t('video.audio')}</h3>
          <Field label={t('video.speed')}>
            {(id) => (
              <Slider
                id={id}
                min={0.25}
                max={4}
                step={0.05}
                value={clip.speed}
                suffix="×"
                aria-label={t('video.speed')}
                onChange={(speed) => editor.setClipSpeed(clip.id, speed)}
              />
            )}
          </Field>
          <Switch
            label={t('video.keepPitch')}
            checked={clip.keepPitch}
            onChange={(keepPitch) => update({ keepPitch })}
          />
          <Field label={t('video.volume')}>
            {(id) => (
              <Slider
                id={id}
                min={0}
                max={2}
                step={0.05}
                value={clip.volume}
                suffix="×"
                aria-label={t('video.volume')}
                onChange={(volume) => update({ volume })}
              />
            )}
          </Field>
          <Switch
            label={t('video.mute')}
            checked={clip.muted}
            onChange={(muted) => update({ muted })}
          />
        </section>
      )}

      <section className={styles.group}>
        <h3 className={panel.sectionTitle}>{t('video.color')}</h3>
        {(
          [
            ['brightness', 'video.brightness'],
            ['contrast', 'video.contrast'],
            ['saturation', 'video.saturation'],
          ] as const
        ).map(([key, labelKey]) => (
          <Field key={key} label={t(labelKey)}>
            {(id) => (
              <Slider
                id={id}
                min={0}
                max={200}
                value={clip.color[key]}
                suffix="%"
                aria-label={t(labelKey)}
                onChange={(value) => update({ color: { ...clip.color, [key]: value } })}
              />
            )}
          </Field>
        ))}
      </section>
    </>
  );
}

function TextProperties({ clip, editor }: { clip: TextClip; editor: VideoEditor }) {
  const t = useT();
  const style = clip.style;
  const update = (changes: Partial<TextClip['style']>) =>
    editor.updateClip(clip.id, { style: { ...style, ...changes } });

  return (
    <section className={styles.group}>
      <h3 className={panel.sectionTitle}>{t('video.text')}</h3>

      <Field label={t('video.text.content')}>
        {(id) => (
          <textarea
            id={id}
            className={styles.textArea}
            value={style.text}
            onChange={(event) => update({ text: event.target.value })}
          />
        )}
      </Field>

      <Field label={t('video.text.font')} inline>
        {(id) => (
          <Select
            id={id}
            value={style.fontFamily}
            onChange={(fontFamily) => update({ fontFamily })}
            options={FONTS.map((font) => ({ value: font.family, label: font.label }))}
          />
        )}
      </Field>

      <Field label={t('video.text.size')}>
        {(id) => (
          <Slider
            id={id}
            min={12}
            max={240}
            value={style.fontSize}
            suffix="px"
            aria-label={t('video.text.size')}
            onChange={(fontSize) => update({ fontSize })}
          />
        )}
      </Field>

      <div className={styles.pair}>
        <Switch label={t('video.text.bold')} checked={style.bold} onChange={(bold) => update({ bold })} />
        <Switch
          label={t('video.text.italic')}
          checked={style.italic}
          onChange={(italic) => update({ italic })}
        />
      </div>

      <Field label={t('video.text.color')} inline>
        {(id) => (
          <ColorInput
            id={id}
            label={t('video.text.color')}
            value={style.color}
            onChange={(color) => update({ color })}
          />
        )}
      </Field>

      <Field label={t('video.text.outlineWidth')}>
        {(id) => (
          <Slider
            id={id}
            min={0}
            max={20}
            value={style.outlineWidth}
            suffix="px"
            aria-label={t('video.text.outlineWidth')}
            onChange={(outlineWidth) => update({ outlineWidth })}
          />
        )}
      </Field>
      {style.outlineWidth > 0 ? (
        <Field label={t('video.text.outline')} inline>
          {(id) => (
            <ColorInput
              id={id}
              label={t('video.text.outline')}
              value={style.outlineColor}
              onChange={(outlineColor) => update({ outlineColor })}
            />
          )}
        </Field>
      ) : null}

      <Switch
        label={t('video.text.shadow')}
        checked={style.shadow}
        onChange={(shadow) => update({ shadow })}
      />

      <Field label={t('video.text.backgroundOpacity')}>
        {(id) => (
          <Slider
            id={id}
            min={0}
            max={1}
            step={0.05}
            value={style.backgroundOpacity}
            aria-label={t('video.text.backgroundOpacity')}
            onChange={(backgroundOpacity) => update({ backgroundOpacity })}
          />
        )}
      </Field>
      {style.backgroundOpacity > 0 ? (
        <Field label={t('video.text.background')} inline>
          {(id) => (
            <ColorInput
              id={id}
              label={t('video.text.background')}
              value={style.backgroundColor}
              onChange={(backgroundColor) => update({ backgroundColor })}
            />
          )}
        </Field>
      ) : null}

      <Field label={t('video.text.align')}>
        {() => (
          <SegmentedControl<TextAlign>
            block
            value={style.align}
            label={t('video.text.align')}
            onChange={(align) => update({ align })}
            segments={[
              { value: 'left', label: t('video.text.align.left') },
              { value: 'center', label: t('video.text.align.center') },
              { value: 'right', label: t('video.text.align.right') },
            ]}
          />
        )}
      </Field>

      <Field label={t('video.text.animateIn')} inline>
        {(id) => (
          <Select<TextAnimation>
            id={id}
            value={style.animateIn}
            onChange={(animateIn) => update({ animateIn })}
            options={ANIMATIONS.map((entry) => ({ value: entry.value, label: t(entry.labelKey) }))}
          />
        )}
      </Field>
      <Field label={t('video.text.animateOut')} inline>
        {(id) => (
          <Select<TextAnimation>
            id={id}
            value={style.animateOut}
            onChange={(animateOut) => update({ animateOut })}
            options={ANIMATIONS.map((entry) => ({ value: entry.value, label: t(entry.labelKey) }))}
          />
        )}
      </Field>
    </section>
  );
}
