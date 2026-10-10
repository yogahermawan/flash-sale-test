import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Both database suites initialise a shared, dedicated test schema. Requests
    // inside each concurrency test remain simultaneous; only test-file setup is serial.
    fileParallelism: false,
  },
});
