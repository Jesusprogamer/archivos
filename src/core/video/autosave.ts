import { SCHEMA_VERSION, type VideoProject } from './project';

/**
 * Local autosave for video projects.
 *
 * Only the project structure is stored — a few kilobytes of JSON. The media is
 * not, and could not be: a browser cannot hold a reference to a file on disk
 * across a reload, and copying gigabytes of video into storage to work around
 * that would be worse than asking for the files again.
 *
 * So clips remember which file they came from by name and size, and reopening a
 * project rebinds them to whatever is in the library. The interface says which
 * files are still missing rather than silently dropping them.
 */

const STORAGE_KEY = 'forja.video.projects';
const MAX_PROJECTS = 8;

export interface SourceFingerprint {
  readonly sourceId: string;
  readonly name: string;
  readonly size: number;
}

export interface SavedProject {
  readonly project: VideoProject;
  readonly savedAt: number;
  /** Enough to find the same files again in a later session. */
  readonly sources: readonly SourceFingerprint[];
}

function readAll(): SavedProject[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Refuse anything written by an older shape rather than crashing on it.
    return (parsed as SavedProject[]).filter(
      (entry) => entry?.project?.schema === SCHEMA_VERSION,
    );
  } catch {
    return [];
  }
}

function writeAll(entries: readonly SavedProject[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_PROJECTS)));
  } catch {
    // Storage full or blocked: autosave is a convenience, not a guarantee, and
    // losing it must never interrupt editing.
  }
}

export function saveProject(project: VideoProject, sources: readonly SourceFingerprint[]): void {
  const entries = readAll().filter((entry) => entry.project.id !== project.id);
  writeAll([{ project, savedAt: Date.now(), sources }, ...entries]);
}

export function listSavedProjects(): readonly SavedProject[] {
  return readAll().sort((a, b) => b.savedAt - a.savedAt);
}

export function loadProject(id: string): SavedProject | undefined {
  return readAll().find((entry) => entry.project.id === id);
}

export function deleteSavedProject(id: string): void {
  writeAll(readAll().filter((entry) => entry.project.id !== id));
}

export interface AvailableFile {
  readonly id: string;
  readonly name: string;
  readonly size: number;
}

/**
 * Matches a saved project's sources against the files currently in the library.
 *
 * Name and size together are a good enough fingerprint in practice, and cheap:
 * hashing a two-gigabyte file to reopen a project would take longer than
 * redoing the edit.
 */
export function rebindSources(
  saved: SavedProject,
  available: readonly AvailableFile[],
): { mapping: Map<string, string>; missing: readonly SourceFingerprint[] } {
  const mapping = new Map<string, string>();
  const missing: SourceFingerprint[] = [];
  const used = new Set<string>();

  for (const fingerprint of saved.sources) {
    const match = available.find(
      (file) =>
        !used.has(file.id) && file.name === fingerprint.name && file.size === fingerprint.size,
    );
    if (match) {
      used.add(match.id);
      mapping.set(fingerprint.sourceId, match.id);
    } else {
      missing.push(fingerprint);
    }
  }
  return { mapping, missing };
}

/** Rewrites a project's source ids through a mapping from `rebindSources`. */
export function applySourceMapping(
  project: VideoProject,
  mapping: ReadonlyMap<string, string>,
): VideoProject {
  return {
    ...project,
    tracks: project.tracks.map((track) => ({
      ...track,
      clips: track.clips.map((clip) =>
        'sourceId' in clip && mapping.has(clip.sourceId)
          ? { ...clip, sourceId: mapping.get(clip.sourceId)! }
          : clip,
      ),
    })),
  };
}
