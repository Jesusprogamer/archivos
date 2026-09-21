import { create } from 'zustand';
import { detectFile } from '../detect/detect';
import { createId } from '../util/id';
import { defaultWorkspaceFor, workspacesFor, type WorkspaceId } from '../registry/workspaces';
import { probeMedia } from './probe';
import type { MediaItem, RejectedFile } from './types';

/**
 * Size thresholds.
 *
 * These are advisory, not enforced: the browser is the one that decides when it
 * runs out of memory, and guessing on its behalf would block work that might
 * well succeed. Above `WARN` we explain the risk; above `BLOCK` we ask for a
 * deliberate confirmation.
 */
export const SIZE_WARN_BYTES = 512 * 1024 * 1024;
export const SIZE_BLOCK_BYTES = 2 * 1024 * 1024 * 1024;

export type SizeVerdict = 'ok' | 'warn' | 'block';

export function sizeVerdict(bytes: number): SizeVerdict {
  if (bytes >= SIZE_BLOCK_BYTES) return 'block';
  if (bytes >= SIZE_WARN_BYTES) return 'warn';
  return 'ok';
}

interface LibraryState {
  items: MediaItem[];
  rejected: RejectedFile[];
  activeId: string | undefined;
  workspace: WorkspaceId | undefined;
  /** True while files are being identified — the drop zone shows a spinner. */
  ingesting: boolean;

  addFiles: (files: readonly File[]) => Promise<MediaItem[]>;
  remove: (id: string) => void;
  clear: () => void;
  setActive: (id: string, workspace?: WorkspaceId) => void;
  setWorkspace: (workspace: WorkspaceId) => void;
  dismissRejected: (id: string) => void;
  replaceFile: (id: string, file: File) => void;
}

function activeItemOf(state: LibraryState): MediaItem | undefined {
  return state.items.find((item) => item.id === state.activeId);
}

export const useLibrary = create<LibraryState>((set, get) => ({
  items: [],
  rejected: [],
  activeId: undefined,
  workspace: undefined,
  ingesting: false,

  addFiles: async (files) => {
    if (files.length === 0) return [];
    set({ ingesting: true });
    const added: MediaItem[] = [];
    const rejected: RejectedFile[] = [];

    for (const file of files) {
      const detection = await detectFile(file);
      if (!detection) {
        rejected.push({ id: createId('rej'), name: file.name, size: file.size, reason: 'unknownFormat' });
        continue;
      }
      if (!detection.format.supported) {
        rejected.push({
          id: createId('rej'),
          name: file.name,
          size: file.size,
          format: detection.format,
          reason: 'noBrowserDecoder',
        });
        continue;
      }
      added.push({
        id: createId('media'),
        file,
        name: file.name,
        size: file.size,
        format: detection.format,
        detectedBy: detection.source,
        url: URL.createObjectURL(file),
      });
    }

    set((state) => ({
      items: [...state.items, ...added],
      rejected: [...state.rejected, ...rejected],
      ingesting: false,
      activeId: state.activeId ?? added[0]?.id,
      workspace:
        state.workspace ?? (added[0] ? defaultWorkspaceFor(added[0].format) : state.workspace),
    }));

    // Probing is deliberately not awaited: the file is usable the moment it is
    // identified, and dimensions/duration fill in a heartbeat later.
    for (const item of added) {
      void probeMedia(item.format, item.url, item.file).then(
        (meta) => {
          set((state) => ({
            items: state.items.map((i) => (i.id === item.id ? { ...i, meta } : i)),
          }));
        },
        (error: unknown) => {
          set((state) => ({
            items: state.items.map((i) =>
              i.id === item.id ? { ...i, probeError: String(error) } : i,
            ),
          }));
        },
      );
    }

    return added;
  },

  remove: (id) => {
    const item = get().items.find((i) => i.id === id);
    if (item) URL.revokeObjectURL(item.url);
    set((state) => {
      const items = state.items.filter((i) => i.id !== id);
      const stillActive = state.activeId === id ? items[0]?.id : state.activeId;
      const next = items.find((i) => i.id === stillActive);
      return {
        items,
        activeId: stillActive,
        workspace: next ? (state.workspace ?? defaultWorkspaceFor(next.format)) : undefined,
      };
    });
  },

  clear: () => {
    for (const item of get().items) URL.revokeObjectURL(item.url);
    set({ items: [], rejected: [], activeId: undefined, workspace: undefined });
  },

  setActive: (id, workspace) => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return;
    const available = workspacesFor(item.format).map((w) => w.id);
    const current = get().workspace;
    const next =
      workspace && available.includes(workspace)
        ? workspace
        : current && available.includes(current)
          ? current
          : defaultWorkspaceFor(item.format);
    set({ activeId: id, workspace: next });
  },

  setWorkspace: (workspace) => set({ workspace }),

  dismissRejected: (id) =>
    set((state) => ({ rejected: state.rejected.filter((r) => r.id !== id) })),

  /** Used by the editors to commit an edited file back into the library. */
  replaceFile: (id, file) =>
    set((state) => ({
      items: state.items.map((item) => {
        if (item.id !== id) return item;
        URL.revokeObjectURL(item.url);
        return { ...item, file, name: file.name, size: file.size, url: URL.createObjectURL(file) };
      }),
    })),
}));

export function useActiveItem(): MediaItem | undefined {
  return useLibrary(activeItemOf);
}
