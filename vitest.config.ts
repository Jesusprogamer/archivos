import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Node by default; the few DOM-dependent suites opt in with
    // `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
