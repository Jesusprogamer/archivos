import { existsSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

export const FIXTURES = path.resolve(import.meta.dirname, '../fixtures');

export function fixture(name: string): string {
  const file = path.join(FIXTURES, name);
  if (!existsSync(file)) {
    throw new Error(
      `Missing test media: ${name}\n` +
        'The end-to-end suite works on real files, which are generated rather ' +
        'than committed. Run:\n\n  npm run fixtures\n\n' +
        '(it needs a full ffmpeg on PATH, or FFMPEG pointing at one)',
    );
  }
  return file;
}

/**
 * Collects console errors and page exceptions for the whole test.
 *
 * "No errors in the console during normal use" is one of the acceptance
 * criteria, so every test asserts on it rather than trusting a manual look.
 */
export function watchForErrors(page: Page): { errors: string[] } {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return { errors };
}

/** Feeds files to the app through the hidden file input the drop zone uses. */
export async function openFiles(page: Page, names: string[]): Promise<void> {
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles(names.map((name) => fixture(name)));
}

export function expectNoErrors(errors: string[]): void {
  expect(errors, `unexpected console errors:\n${errors.join('\n')}`).toEqual([]);
}
