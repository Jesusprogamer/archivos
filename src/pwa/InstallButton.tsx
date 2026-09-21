import { Download } from 'lucide-react';
import { useT } from '../i18n';
import { Button } from '../ui/Button';
import { toast } from '../ui/toast';
import { promptInstall, usePwa } from './install';

/**
 * El botón de instalar.
 *
 * No se dibuja salvo que el navegador haya dicho que sí se puede instalar, así
 * que nunca aparece un botón que no haga nada. En iPhone, donde la instalación
 * es manual, las instrucciones viven en Ajustes: no hay diálogo que lanzar.
 */
export function InstallButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const t = useT();
  const path = usePwa((state) => state.path);
  if (path !== 'prompt') return null;

  const install = async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') {
      toast.success(t('pwa.installedToast'), t('pwa.installedToastText'));
    }
  };

  return (
    <Button
      variant={iconOnly ? 'ghost' : 'secondary'}
      size="sm"
      iconOnly={iconOnly}
      aria-label={t('pwa.install')}
      onClick={() => void install()}
    >
      <Download size={15} aria-hidden="true" />
      {iconOnly ? null : t('pwa.installShort')}
    </Button>
  );
}
