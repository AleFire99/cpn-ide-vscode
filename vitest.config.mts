import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    testTimeout: 120000,
    // Real-backend tests share the simulator's fixed port 20001, so run files one at a time.
    fileParallelism: !process.env.CPN_IT,
  },
});
