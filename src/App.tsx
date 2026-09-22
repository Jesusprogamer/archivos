import { useCallback, useEffect, useState } from 'react';
import { HelpCircle, Settings as SettingsIcon } from 'lucide-react';
import { useActiveItem, useLibrary } from './core/media/library';
import { useT } from './i18n';
import { Button } from './ui/Button';
import { Toasts } from './ui/Toasts';
import { Help } from './app/Help';
import { Home } from './app/Home';
import { Settings } from './app/Settings';
import { Studio } from './app/Studio';
import { useFileDrop } from './app/useFileDrop';
import { useNarrow } from './app/useNarrow';
import { InstallButton } from './pwa/InstallButton';
import { applyUpdate, usePwa } from './pwa/install';
import { startLaunchQueue } from './pwa/launch';
import { useToasts } from './ui/toast';

export function App() {
  const t = useT();
  const addFiles = useLibrary((state) => state.addFiles);
  const ingesting = useLibrary((state) => state.ingesting);
  const item = useActiveItem();
  const workspace = useLibrary((state) => state.workspace);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const narrow = useNarrow();
  // En móvil la biblioteca tapa el editor, así que empieza cerrada. En
  // escritorio es una columna más y empieza abierta.
  const [libraryCollapsed, setLibraryCollapsed] = useState(narrow);

  // Al elegir un archivo en una pantalla estrecha, el cajón estorba: lo que
  // quieres ver es lo que acabas de abrir.
  const [lastItemId, setLastItemId] = useState(item?.id);
  if (item?.id !== lastItemId) {
    setLastItemId(item?.id);
    if (narrow && item) setLibraryCollapsed(true);
  }

  const onFiles = useCallback((files: File[]) => void addFiles(files), [addFiles]);
  const { dragging } = useFileDrop(onFiles);

  // Archivos abiertos desde el sistema operativo, cuando Forja está instalada.
  useEffect(() => {
    startLaunchQueue(onFiles);
  }, [onFiles]);

  // Una versión nueva ya descargada. No se aplica sola: hacerlo cambiaría los
  // ficheros bajo una sesión con trabajo a medias.
  const updateReady = usePwa((state) => state.updateReady);
  useEffect(() => {
    if (!updateReady) return;
    // Se queda hasta que se cierre: perder un aviso de actualización a los
    // cinco segundos es perderlo del todo.
    useToasts.getState().push({
      tone: 'info',
      title: t('pwa.updateReady'),
      text: t('pwa.updateReadyText'),
      duration: 0,
      action: { label: t('pwa.update'), onClick: applyUpdate },
    });
  }, [updateReady, t]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;

      if (event.key === '?' || (event.key === '/' && event.shiftKey)) {
        event.preventDefault();
        setHelpOpen((open) => !open);
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault();
        setLibraryCollapsed((collapsed) => !collapsed);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const actions = (
    <span style={{ display: 'flex', gap: 'var(--s-1)', alignItems: 'center' }}>
      <InstallButton />
      <Button variant="ghost" size="sm" iconOnly aria-label={t('common.help')} onClick={() => setHelpOpen(true)}>
        <HelpCircle size={16} aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        iconOnly
        aria-label={t('common.settings')}
        onClick={() => setSettingsOpen(true)}
      >
        <SettingsIcon size={16} aria-hidden="true" />
      </Button>
    </span>
  );

  return (
    <>
      <a href="#main" className="sr-only">
        {t('a11y.skipToContent')}
      </a>

      {item ? (
        <Studio
          item={item}
          dragging={dragging}
          onFiles={onFiles}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenHelp={() => setHelpOpen(true)}
          libraryCollapsed={libraryCollapsed}
          onToggleLibrary={() => setLibraryCollapsed((collapsed) => !collapsed)}
        />
      ) : (
        <Home dragging={dragging} busy={ingesting} onFiles={onFiles} actions={actions} />
      )}

      <Settings open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <Help open={helpOpen} onClose={() => setHelpOpen(false)} workspace={workspace} />
      <Toasts />
    </>
  );
}
