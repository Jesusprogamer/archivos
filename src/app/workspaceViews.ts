import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { MediaItem } from '../core/media/types';
import type { WorkspaceId } from '../core/registry/workspaces';

export interface WorkspaceViewProps {
  item: MediaItem;
}

/**
 * The workspaces that exist.
 *
 * The tab bar is built from this map, so a workspace that has not been written
 * cannot appear as a tab that leads nowhere.
 *
 * Each one is loaded on demand. Someone who opens Forja to convert a PNG has no
 * reason to download the video editor's timeline, the ONNX glue or the audio
 * effects — and the landing page has no reason to download any of them.
 */
export const WORKSPACE_VIEWS: Partial<
  Record<WorkspaceId, LazyExoticComponent<ComponentType<WorkspaceViewProps>>>
> = {
  convert: lazy(async () => ({
    default: (await import('../workspaces/convert/ConvertWorkspace')).ConvertWorkspace,
  })),
  image: lazy(async () => ({
    default: (await import('../workspaces/image/ImageWorkspace')).ImageWorkspace,
  })),
  audio: lazy(async () => ({
    default: (await import('../workspaces/audio/AudioWorkspace')).AudioWorkspace,
  })),
  video: lazy(async () => ({
    default: (await import('../workspaces/video/VideoWorkspace')).VideoWorkspace,
  })),
  visualizer: lazy(async () => ({
    default: (await import('../workspaces/visualizer/VisualizerWorkspace')).VisualizerWorkspace,
  })),
};
