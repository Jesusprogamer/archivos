import type { Format, MediaKind } from '../detect/formats';
import type { TranslationKey } from '../../i18n';

/**
 * A workspace is a way of working with a file. The registry maps a detected
 * format to the workspaces that genuinely apply to it, so adding a new file
 * type later means adding a row here rather than touching the shell.
 */
export type WorkspaceId = 'convert' | 'image' | 'audio' | 'video' | 'visualizer';

export interface WorkspaceDefinition {
  readonly id: WorkspaceId;
  readonly labelKey: TranslationKey;
  /** Which media kinds this workspace can open as its primary subject. */
  readonly accepts: readonly MediaKind[];
}

export const WORKSPACES: readonly WorkspaceDefinition[] = [
  { id: 'convert', labelKey: 'workspace.convert', accepts: ['image', 'audio', 'video'] },
  { id: 'image', labelKey: 'workspace.image', accepts: ['image'] },
  { id: 'audio', labelKey: 'workspace.audio', accepts: ['audio'] },
  { id: 'visualizer', labelKey: 'workspace.visualizer', accepts: ['audio'] },
  { id: 'video', labelKey: 'workspace.video', accepts: ['video'] },
];

/** The workspaces offered for a file, in the order they appear in the tab bar. */
export function workspacesFor(format: Format): readonly WorkspaceDefinition[] {
  if (!format.supported) return [];
  const editors = WORKSPACES.filter((w) => w.id !== 'convert' && w.accepts.includes(format.kind));
  const convert = WORKSPACES.find((w) => w.id === 'convert')!;
  return [...editors, convert];
}

/** The workspace a file opens in when it is dropped. */
export function defaultWorkspaceFor(format: Format): WorkspaceId {
  return workspacesFor(format)[0]?.id ?? 'convert';
}

export function workspaceLabelKey(id: WorkspaceId): TranslationKey {
  return WORKSPACES.find((w) => w.id === id)?.labelKey ?? 'workspace.convert';
}
