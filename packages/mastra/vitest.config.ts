import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'mastra', environment: 'node', include: ['src/**/*.test.ts'] },
});
