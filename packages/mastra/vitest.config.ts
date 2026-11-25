import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'mastra',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Mastra ships product telemetry. Tests must not send any.
    env: { MASTRA_TELEMETRY_DISABLED: '1' },
  },
});
