import { expect, test, vi } from 'vitest';
import { createDoneGate } from './index.ts';

// The optional peer dependency is not installed.
vi.mock('@opentelemetry/api', () => {
  throw new Error("Cannot find package '@opentelemetry/api'");
});

test('the gate works when @opentelemetry/api is not installed', async () => {
  const gate = createDoneGate({ check: () => ({ ok: false, reason: 'No booking found' }) });

  expect(await gate.decide('booked')).toEqual({
    accepted: false,
    reason: 'No booking found',
    refusalsLeft: 2,
  });
});
