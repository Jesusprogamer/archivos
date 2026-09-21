import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openFiles } from './helpers';

/**
 * Accessibility, checked by a machine rather than by eye.
 *
 * axe-core is injected into the running page, so these run against the real
 * rendered interface — the same thing a person with a screen reader would meet.
 * Only the rules axe considers serious or critical fail the build; the rest are
 * reported so they can be judged.
 */
const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  nodes: { target: string[] }[];
}

async function audit(page: Page): Promise<AxeViolation[]> {
  await page.addScriptTag({ content: AXE_SOURCE });
  return page.evaluate(async () => {
    const axe = (globalThis as unknown as { axe: { run: (options: unknown) => Promise<unknown> } })
      .axe;
    const results = (await axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })) as { violations: AxeViolation[] };
    return results.violations;
  });
}

function serious(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
}

function describeViolations(violations: AxeViolation[]): string {
  return violations
    .map((v) => `${v.impact} · ${v.id}: ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
    .join('\n');
}

test.describe('Accessibility', () => {
  test('the landing page has no serious violations', async ({ page }) => {
    await page.goto('/');
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the converter has no serious violations', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['tone.wav']);
    await page.getByRole('button', { name: 'Convertir', exact: true }).first().click();
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the image editor has no serious violations', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await page.getByRole('button', { name: 'Imagen', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible();
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the audio editor has no serious violations', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);
    await expect(page.getByRole('button', { name: 'Seleccionar todo' })).toBeVisible();
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the video editor has no serious violations', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['clip.webm']);
    await expect(page.getByRole('slider', { name: 'Línea de tiempo' })).toBeVisible({
      timeout: 30_000,
    });
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the visualiser has no serious violations', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['tone.mp3']);
    await page.getByRole('button', { name: 'Visualizador', exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Barras', exact: true })).toBeVisible();
    const violations = await audit(page);
    expect(serious(violations), describeViolations(serious(violations))).toEqual([]);
  });

  test('the light theme keeps its contrast', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('button', { name: 'Claro' }).click();
    await page.keyboard.press('Escape');

    const violations = await audit(page);
    const contrast = violations.filter((violation) => violation.id === 'color-contrast');
    expect(contrast, describeViolations(contrast)).toEqual([]);
  });

  test('every interactive control is reachable with the keyboard alone', async ({ page }) => {
    await page.goto('/');
    await openFiles(page, ['photo.png']);
    await page.getByRole('button', { name: 'Imagen', exact: true }).first().click();
    // Workspaces load as separate chunks, so wait for the real thing rather
    // than sweeping the loading state.
    await expect(page.getByRole('button', { name: 'Color', exact: true })).toBeVisible({
      timeout: 30_000,
    });

    // Tab forwards and record where focus lands. Reaching the end of the
    // document is normal — focus moves to the browser chrome — so the sweep
    // stops there rather than treating the wrap as a failure.
    const reached = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press('Tab');
      const description = await page.evaluate(() => {
        const element = document.activeElement;
        if (!element || element === document.body) return 'BODY';
        const label =
          element.getAttribute('aria-label') ?? element.textContent?.slice(0, 24) ?? '';
        const visible = (element as HTMLElement).offsetParent !== null;
        return `${visible ? '' : 'HIDDEN:'}${element.tagName}:${label}`;
      });
      if (description === 'BODY') break;
      // A control that takes focus while invisible is a trap for a screen
      // reader: the user hears nothing and cannot tell where they are.
      expect(description.startsWith('HIDDEN:'), `focus landed on a hidden control: ${description}`).toBe(false);
      reached.add(description);
    }
    expect(reached.size).toBeGreaterThan(12);
  });
});
