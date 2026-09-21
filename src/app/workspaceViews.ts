import type { ComponentType } from 'react';
import type { MediaItem } from '../core/media/types';
import type { WorkspaceId } from '../core/registry/workspaces';

export interface WorkspaceViewProps {
  item: MediaItem;
}

/**
 * The workspaces that exist right now.
 *
 * The tab bar is built from this map, so a workspace that has not been written
 * yet simply does not appear — there is never a tab that leads nowhere. Each
 * phase adds its entry here.
 */
export const WORKSPACE_VIEWS: Partial<Record<WorkspaceId, ComponentType<WorkspaceViewProps>>> = {};
