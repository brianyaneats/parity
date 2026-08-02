import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', '.next', 'e2e'],
    environmentMatchGlobs: [
      ['src/components/**', 'jsdom'],
      ['src/app/**', 'jsdom'],
      ['**/*.dom.test.{ts,tsx}', 'jsdom'],
    ],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      include: ['src/domain/**/*.ts', 'src/application/**/*.ts'],
      exclude: [
        'src/domain/**/__fixtures__/**',
        'src/domain/**/*.test.ts',
        'src/domain/**/index.ts',
        'src/application/**/*.test.ts',
        // Declaration-only modules. They compile to nothing executable, so v8
        // reports 0/0 and drags the ratio down without any code going untested.
        'src/domain/engine/types.ts',
        'src/domain/**/*.d.ts',
      ],
      thresholds: {
        // §10.1: the engine is the product. 100% of branches.
        'src/domain/engine/**/*.ts': {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
    },
  },
});
