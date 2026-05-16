import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // better-sqlite3 is a native addon and does not survive worker teardown, so the
    // suite runs in forked processes rather than worker threads. Isolation between
    // files is off because every test builds its own in memory store and closes it,
    // and re-importing the module graph per file cost more than the tests did.
    pool: 'forks',
    poolOptions: {
      forks: {
        isolate: false,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      reporter: ['text', 'lcov'],
      // Raised as the command layer got its own tests. The numbers sit just
      // under where the suite actually stands, so a change that drops coverage
      // by a percent fails rather than eroding it a commit at a time.
      thresholds: {
        statements: 91,
        branches: 86,
        functions: 98,
        lines: 91,
      },
    },
  },
});
