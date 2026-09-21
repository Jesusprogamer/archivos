import { useT, useLocaleStore, LOCALES, type Locale } from '../i18n';
import { capabilities } from '../core/util/capabilities';
import { Dialog } from '../ui/Dialog';
import { Field } from '../ui/Field';
import { Notice } from '../ui/Notice';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Select } from '../ui/Select';
import { cx } from '../ui/cx';
import { useTheme, type ThemePreference } from './theme';
import panel from './Panel.module.css';

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const locale = useLocaleStore((state) => state.locale);
  const setLocale = useLocaleStore((state) => state.setLocale);
  const preference = useTheme((state) => state.preference);
  const setPreference = useTheme((state) => state.setPreference);
  const caps = capabilities();

  return (
    <Dialog open={open} onClose={onClose} title={t('settings.title')}>
      <Field label={t('settings.language')} inline>
        {(id) => (
          <Select<Locale>
            id={id}
            value={locale}
            options={LOCALES.map((l) => ({ value: l.value, label: l.label }))}
            onChange={setLocale}
          />
        )}
      </Field>

      <Field label={t('settings.theme')} inline>
        {() => (
          <SegmentedControl<ThemePreference>
            value={preference}
            onChange={setPreference}
            label={t('settings.theme')}
            segments={[
              { value: 'dark', label: t('settings.theme.dark') },
              { value: 'light', label: t('settings.theme.light') },
              { value: 'system', label: t('settings.theme.system') },
            ]}
          />
        )}
      </Field>

      <section>
        <h3 className={panel.sectionTitle}>{t('settings.performance')}</h3>
        <dl className={panel.specs}>
          <dt>{t('settings.isolation')}</dt>
          <dd>{caps.crossOriginIsolated ? t('settings.isolationOn') : t('settings.isolationOff')}</dd>
          <dt>{t('settings.webcodecs')}</dt>
          <dd>{caps.webCodecs ? t('settings.webcodecsOn') : t('settings.webcodecsOff')}</dd>
          <dt>{t('settings.threads')}</dt>
          <dd>{caps.hardwareConcurrency}</dd>
        </dl>
        {caps.crossOriginIsolated ? null : (
          <Notice tone="info" className={cx(panel.spaced)}>
            {t('settings.isolationHelp')}
          </Notice>
        )}
      </section>
    </Dialog>
  );
}
