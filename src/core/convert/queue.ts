import { create } from 'zustand';
import type { MediaItem } from '../media/types';
import { createId } from '../util/id';
import { FFmpegCancelled } from '../ffmpeg/client';
import { runConversion, outputFileName } from './run';
import type { ConversionOptions } from './options';
import { targetById, type Target } from './targets';

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface Job {
  readonly id: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly targetId: string;
  readonly outputName: string;
  readonly status: JobStatus;
  /** 0–1, only meaningful while running. */
  readonly progress: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
  readonly result?: { blob: Blob; fileName: string };
  readonly error?: string;
}

interface QueueState {
  jobs: Job[];
  running: boolean;
  enqueue: (items: readonly MediaItem[], target: Target, options: ConversionOptions) => void;
  cancel: (jobId: string) => void;
  cancelAll: () => void;
  remove: (jobId: string) => void;
  clearFinished: () => void;
  reset: () => void;
}

/** Abort controllers live outside the store: they are not state to render. */
const controllers = new Map<string, AbortController>();
/** Items are held by id so a job can run after its row scrolls out of view. */
const itemsById = new Map<string, MediaItem>();
const optionsByJob = new Map<string, ConversionOptions>();

function patch(id: string, changes: Partial<Job>): void {
  useQueue.setState((state) => ({
    jobs: state.jobs.map((job) => (job.id === id ? { ...job, ...changes } : job)),
  }));
}

/**
 * Drains the queue one job at a time.
 *
 * Sequential is not a limitation but the correct behaviour: there is one
 * ffmpeg instance with one virtual filesystem, and running two encodes at once
 * on the same cores would finish later, not sooner.
 */
async function drain(): Promise<void> {
  if (useQueue.getState().running) return;
  useQueue.setState({ running: true });

  try {
    for (;;) {
      const job = useQueue.getState().jobs.find((candidate) => candidate.status === 'queued');
      if (!job) break;

      const item = itemsById.get(job.itemId);
      const target = targetById(job.targetId);
      const options = optionsByJob.get(job.id);
      if (!item || !target || !options) {
        patch(job.id, { status: 'error', error: 'missing input' });
        continue;
      }

      const controller = new AbortController();
      controllers.set(job.id, controller);
      patch(job.id, { status: 'running', progress: 0, startedAt: Date.now() });

      try {
        const result = await runConversion(item, target, options, {
          signal: controller.signal,
          onProgress: (progress) => patch(job.id, { progress }),
        });
        patch(job.id, { status: 'done', progress: 1, result, finishedAt: Date.now() });
      } catch (error) {
        if (error instanceof FFmpegCancelled || controller.signal.aborted) {
          patch(job.id, { status: 'cancelled', finishedAt: Date.now() });
        } else {
          patch(job.id, {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            finishedAt: Date.now(),
          });
        }
      } finally {
        controllers.delete(job.id);
        optionsByJob.delete(job.id);
      }
    }
  } finally {
    useQueue.setState({ running: false });
  }
}

export const useQueue = create<QueueState>((set, get) => ({
  jobs: [],
  running: false,

  enqueue: (items, target, options) => {
    const jobs = items.map((item) => {
      const id = createId('job');
      itemsById.set(item.id, item);
      optionsByJob.set(id, structuredClone(options));
      return {
        id,
        itemId: item.id,
        itemName: item.name,
        targetId: target.id,
        outputName: outputFileName(item, target),
        status: 'queued' as const,
        progress: 0,
      };
    });
    set((state) => ({ jobs: [...state.jobs, ...jobs] }));
    void drain();
  },

  cancel: (jobId) => {
    const job = get().jobs.find((candidate) => candidate.id === jobId);
    if (!job) return;
    if (job.status === 'queued') {
      patch(jobId, { status: 'cancelled' });
      optionsByJob.delete(jobId);
      return;
    }
    controllers.get(jobId)?.abort();
  },

  cancelAll: () => {
    for (const job of get().jobs) {
      if (job.status === 'queued' || job.status === 'running') get().cancel(job.id);
    }
  },

  remove: (jobId) => {
    controllers.get(jobId)?.abort();
    optionsByJob.delete(jobId);
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== jobId) }));
  },

  clearFinished: () =>
    set((state) => ({
      jobs: state.jobs.filter((job) => job.status === 'queued' || job.status === 'running'),
    })),

  reset: () => {
    get().cancelAll();
    itemsById.clear();
    optionsByJob.clear();
    set({ jobs: [] });
  },
}));

/**
 * Remaining time for a running job, from its own measured rate.
 *
 * Returns `undefined` rather than a guess when there is not enough signal yet:
 * a wildly wrong estimate is worse than none.
 */
export function estimateRemaining(job: Job, now = Date.now()): number | undefined {
  if (job.status !== 'running' || !job.startedAt) return undefined;
  const elapsed = (now - job.startedAt) / 1000;
  if (elapsed < 1.5 || job.progress < 0.03) return undefined;
  return Math.round((elapsed / job.progress) * (1 - job.progress));
}
