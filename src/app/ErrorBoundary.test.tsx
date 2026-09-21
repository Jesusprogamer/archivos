// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

function render(node: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(node));
  return container;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    // React logs the caught error itself; the boundary logs it again on
    // purpose. Neither belongs in the test output.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
    document.documentElement.lang = 'es';
  });

  it('renders its children when nothing throws', () => {
    const container = render(
      <ErrorBoundary>
        <p>contenido</p>
      </ErrorBoundary>,
    );
    expect(container.textContent).toBe('contenido');
  });

  it('shows a readable message instead of an empty page when a child throws', () => {
    const container = render(
      <ErrorBoundary>
        <Boom message="se rompió el lienzo" />
      </ErrorBoundary>,
    );

    // The symptom this exists to prevent is a blank page, so the useful
    // assertion is that something was actually painted.
    expect(container.textContent).not.toBe('');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(container.textContent).toContain('Forja se ha roto');
    expect(container.textContent).toContain('se rompió el lienzo');
  });

  it('keeps the promise that files never left the device', () => {
    const container = render(
      <ErrorBoundary>
        <Boom message="x" />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('nunca se enviaron');
  });

  it('offers a reload and a clear-local-data escape hatch', () => {
    const container = render(
      <ErrorBoundary>
        <Boom message="x" />
      </ErrorBoundary>,
    );
    const labels = [...container.querySelectorAll('button')].map((button) => button.textContent);
    expect(labels).toEqual(['Recargar la página', 'Borrar datos locales y recargar']);
  });

  it('follows the document language', () => {
    document.documentElement.lang = 'en';
    const container = render(
      <ErrorBoundary>
        <Boom message="x" />
      </ErrorBoundary>,
    );
    expect(container.textContent).toContain('Forja broke');
    expect(container.textContent).toContain('never sent anywhere');
  });

  it('reports the crash to the console, the only place a user can copy it from', () => {
    render(
      <ErrorBoundary>
        <Boom message="detalle copiable" />
      </ErrorBoundary>,
    );
    const calls = vi.mocked(console.error).mock.calls;
    expect(calls.some((call) => call[0] === '[forja] render crash')).toBe(true);
  });
});
