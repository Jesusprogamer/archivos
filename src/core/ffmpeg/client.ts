import { FFmpeg } from '@ffmpeg/ffmpeg';
import { capabilities } from '../util/capabilities';

/**
 * The single ffmpeg.wasm instance.
 *
 * ffmpeg.wasm already runs its core in a dedicated Web Worker, so nothing here
 * blocks the interface. What this module adds is the rest of what a studio
 * needs: one instance rather than one per job, a lazy first load with real
 * download progress, a queue so two jobs cannot trample each other's virtual
 * filesystem, and cancellation.
 *
 * Cancelling means terminating the worker — ffmpeg.wasm has no way to interrupt
 * a running command — so the next job pays the load cost again. That is the
 * honest trade, and the UI says so.
 */

export interface RunOptions {
  /** 0–1 for the current command, when ffmpeg can report it. */
  onProgress?: (progress: number, timeSeconds: number) => void;
  /** Raw ffmpeg log lines, for diagnosing a failure. */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

export interface LoadProgress {
  /** 0–1 of the core download, or `undefined` before the size is known. */
  received: number;
  total: number;
}

export class FFmpegCancelled extends Error {
  constructor() {
    super('cancelled');
    this.name = 'FFmpegCancelled';
  }
}

export class FFmpegFailed extends Error {
  readonly log: readonly string[];
  constructor(message: string, log: readonly string[]) {
    super(message);
    this.name = 'FFmpegFailed';
    this.log = log;
  }
}

type LoadListener = (progress: LoadProgress) => void;

const CORE_BASE = {
  single: '/ffmpeg/core',
  multi: '/ffmpeg/core-mt',
} as const;

class FFmpegClient {
  private instance: FFmpeg | undefined;
  private loading: Promise<FFmpeg> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly loadListeners = new Set<LoadListener>();

  /** True once the core is in memory; used to warn before a first long wait. */
  get loaded(): boolean {
    return this.instance !== undefined;
  }

  /** Which core will be used, so the UI can explain the speed difference. */
  get variant(): 'single' | 'multi' {
    return capabilities().crossOriginIsolated && capabilities().sharedArrayBuffer
      ? 'multi'
      : 'single';
  }

  onLoadProgress(listener: LoadListener): () => void {
    this.loadListeners.add(listener);
    return () => this.loadListeners.delete(listener);
  }

  /**
   * Fetches a core file with progress. `ffmpeg.load()` accepts blob URLs, so we
   * do the download ourselves rather than lose the progress bar to its internal
   * fetch.
   */
  private async fetchWithProgress(url: string, type: string, weight: number): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const total = Number(response.headers.get('content-length') ?? 0) || weight;
    const reader = response.body?.getReader();
    if (!reader) {
      return URL.createObjectURL(new Blob([await response.arrayBuffer()], { type }));
    }

    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      for (const listener of this.loadListeners) listener({ received, total });
    }
    return URL.createObjectURL(new Blob(chunks as BlobPart[], { type }));
  }

  async load(): Promise<FFmpeg> {
    if (this.instance) return this.instance;
    this.loading ??= (async () => {
      const base = CORE_BASE[this.variant];
      // The wasm dwarfs the glue script, so it carries the progress bar.
      const [coreURL, wasmURL] = await Promise.all([
        this.fetchWithProgress(`${base}/ffmpeg-core.js`, 'text/javascript', 130_000),
        this.fetchWithProgress(`${base}/ffmpeg-core.wasm`, 'application/wasm', 32_000_000),
      ]);
      const workerURL =
        this.variant === 'multi'
          ? await this.fetchWithProgress(
              `${base}/ffmpeg-core.worker.js`,
              'text/javascript',
              3_000,
            )
          : undefined;

      const ffmpeg = new FFmpeg();
      const ok = await ffmpeg.load({
        coreURL,
        wasmURL,
        ...(workerURL ? { workerURL } : {}),
      });
      if (!ok) throw new Error('ffmpeg.wasm refused to load');
      this.instance = ffmpeg;
      return ffmpeg;
    })();

    try {
      return await this.loading;
    } catch (error) {
      this.loading = undefined;
      throw error;
    }
  }

  /**
   * Runs one command. Calls are queued, so callers never have to think about
   * the shared virtual filesystem.
   */
  run(args: string[], options: RunOptions = {}): Promise<void> {
    const task = this.queue.then(
      () => this.execute(args, options),
      () => this.execute(args, options),
    );
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async execute(args: string[], options: RunOptions): Promise<void> {
    if (options.signal?.aborted) throw new FFmpegCancelled();
    const ffmpeg = await this.load();
    const log: string[] = [];

    const onLog = ({ message }: { message: string }) => {
      log.push(message);
      if (log.length > 400) log.shift();
      options.onLog?.(message);
    };
    const onProgress = ({ progress, time }: { progress: number; time: number }) => {
      // ffmpeg occasionally reports progress above 1 near the end.
      options.onProgress?.(Math.max(0, Math.min(1, progress)), time / 1_000_000);
    };

    ffmpeg.on('log', onLog);
    ffmpeg.on('progress', onProgress);

    let cancelled = false;
    const abort = () => {
      cancelled = true;
      this.terminate();
    };
    options.signal?.addEventListener('abort', abort, { once: true });

    try {
      const code = await ffmpeg.exec(args);
      if (cancelled) throw new FFmpegCancelled();
      if (code !== 0) throw new FFmpegFailed(`ffmpeg exited with ${code}`, log);
    } catch (error) {
      if (cancelled) throw new FFmpegCancelled();
      if (error instanceof FFmpegFailed) throw error;
      throw new FFmpegFailed(error instanceof Error ? error.message : String(error), log);
    } finally {
      options.signal?.removeEventListener('abort', abort);
      if (!cancelled) {
        ffmpeg.off('log', onLog);
        ffmpeg.off('progress', onProgress);
      }
    }
  }

  async writeFile(name: string, data: Uint8Array): Promise<void> {
    const ffmpeg = await this.load();
    // `writeFile` transfers the buffer, leaving the caller's view detached.
    // Copying keeps the caller's data usable — a lesson from the spike.
    await ffmpeg.writeFile(name, new Uint8Array(data));
  }

  async readFile(name: string): Promise<Uint8Array> {
    const ffmpeg = await this.load();
    const data = await ffmpeg.readFile(name);
    if (typeof data === 'string') throw new Error(`${name} came back as text`);
    return data;
  }

  async deleteFile(name: string): Promise<void> {
    if (!this.instance) return;
    try {
      await this.instance.deleteFile(name);
    } catch {
      // Already gone, or the worker was terminated — nothing to clean up.
    }
  }

  /** Kills the worker. The next call reloads the core from scratch. */
  terminate(): void {
    this.instance?.terminate();
    this.instance = undefined;
    this.loading = undefined;
  }
}

export const ffmpeg = new FFmpegClient();
