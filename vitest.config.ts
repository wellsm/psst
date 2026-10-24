import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
    environment: 'node',
    // Colyseus talks to process.send (PM2) when it exists; forked workers have it.
    pool: 'threads',
  },
});
