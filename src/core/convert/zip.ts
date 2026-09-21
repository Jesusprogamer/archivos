import { zip, type Zippable } from 'fflate';

/**
 * Bundles finished conversions into a ZIP, in memory.
 *
 * fflate compresses in its own worker pool; the files here are already
 * compressed media, so `level: 0` (store) is both faster and, in practice,
 * smaller than re-deflating a JPEG.
 */
export async function createZip(
  files: ReadonlyArray<{ name: string; blob: Blob }>,
): Promise<Blob> {
  const entries: Zippable = {};
  const used = new Map<string, number>();

  for (const file of files) {
    // Two inputs can share a base name; a ZIP with duplicate paths is invalid.
    const count = used.get(file.name) ?? 0;
    used.set(file.name, count + 1);
    const name =
      count === 0 ? file.name : file.name.replace(/(\.[^.]+)$/, ` (${count})$1`);
    entries[name] = [new Uint8Array(await file.blob.arrayBuffer()), { level: 0 }];
  }

  return new Promise<Blob>((resolve, reject) => {
    zip(entries, { level: 0 }, (error, data) => {
      if (error) reject(error);
      else resolve(new Blob([data], { type: 'application/zip' }));
    });
  });
}

/** Hands a blob to the browser's downloader and cleans up after itself. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
