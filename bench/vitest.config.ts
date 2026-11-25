import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'bench',
    environment: 'node',
    include: ['*.test.ts'],
    // Mastra ships product telemetry. Tests must not send any.
    env: { MASTRA_TELEMETRY_DISABLED: '1' },
  },
});
