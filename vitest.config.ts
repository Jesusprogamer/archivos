import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Only the .tsx suites need the JSX transform, but the plugin is a no-op
  // for the plain .ts ones.
  plugins: [react()],
  test: {
    // Node by default; the few DOM-dependent suites opt in with
    // `// @vitest-environment jsdom` at the top of the file.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
