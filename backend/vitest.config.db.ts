import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

// Tests against a real, throw-away PostgreSQL (see test/db/global-setup.ts).
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.db-spec.ts'],
    globalSetup: ['./test/db/global-setup.ts'],
    setupFiles: ['./test/db/setup.ts'],
    // One shared database: files run one after another, each test starts from empty tables.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
