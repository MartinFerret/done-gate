import { afterEach, describe, expect, test, vi } from 'vitest';
import { type Check, type CheckResult, createDoneGate } from './index.ts';

const pass: CheckResult = { ok: true };
const fail = (reason: string): CheckResult => ({ ok: false, reason });

afterEach(() => {
  vi.useRealTimers();
});

describe('decide', () => {
  test('accepts when the check passes', async () => {
    const gate = createDoneGate({ check: () => pass });

    expect(await gate.decide('booked')).toEqual({ accepted: true });
    expect(gate.outcome).toBe('done');
  });

  test('refuses with the reason of the check and stays open', async () => {
    const gate = createDoneGate({ check: () => fail('No booking found'), maxRefusals: 3 });

    expect(await gate.decide('booked')).toEqual({
      accepted: false,
      reason: 'No booking found',
      refusalsLeft: 2,
    });
    expect(gate.outcome).toBe('pending');
  });

  test('accepts a later claim once the check passes', async () => {
    const results = [fail('No booking found'), pass];
    const gate = createDoneGate({ check: () => results.shift() ?? pass });

    expect((await gate.decide('booked')).accepted).toBe(false);
    expect(await gate.decide('booked again')).toEqual({ accepted: true });
    expect(gate.outcome).toBe('done');
    expect(gate.refusals).toBe(1);
  });

  test('gives the check the claim, the attempt number and an abort signal', async () => {
    const check = vi.fn<Check>(() => pass);
    const gate = createDoneGate({ check });

    await gate.decide('booked');

    expect(check).toHaveBeenCalledWith({
      claim: 'booked',
      attempt: 1,
      signal: expect.any(AbortSignal),
    });
  });
});

describe('refusal budget', () => {
  test('the refusal that uses up the budget ends the run as not done', async () => {
    const gate = createDoneGate({ check: () => fail('No booking found'), maxRefusals: 2 });

    expect(await gate.decide('booked')).toMatchObject({ accepted: false, refusalsLeft: 1 });
    expect(gate.outcome).toBe('pending');
    expect(await gate.decide('booked')).toMatchObject({ accepted: false, refusalsLeft: 0 });
    expect(gate.outcome).toBe('not_done');
  });

  test('a run that ended as not done can never become a success', async () => {
    const results = [fail('No booking found'), pass];
    const check = vi.fn<Check>(() => results.shift() ?? pass);
    const gate = createDoneGate({ check, maxRefusals: 1 });

    await gate.decide('booked');
    const late = await gate.decide('booked, really');

    expect(late).toMatchObject({ accepted: false, refusalsLeft: 0 });
    expect(gate.outcome).toBe('not_done');
    expect(check).toHaveBeenCalledTimes(1);
  });

  test('an accepted run stays accepted without asking again', async () => {
    const check = vi.fn<Check>(() => pass);
    const gate = createDoneGate({ check });

    await gate.decide('booked');

    expect(await gate.decide('booked')).toEqual({ accepted: true });
    expect(check).toHaveBeenCalledTimes(1);
  });

  test('rejects a budget that is not a positive integer', () => {
    expect(() => createDoneGate({ check: () => pass, maxRefusals: 0 })).toThrow(TypeError);
    expect(() => createDoneGate({ check: () => pass, maxRefusals: 1.5 })).toThrow(TypeError);
  });
});

describe('a check that cannot answer is a refusal, never a pass', () => {
  test('a check that throws', async () => {
    const gate = createDoneGate({
      check: () => {
        throw new Error('connection refused');
      },
    });

    expect(await gate.decide('booked')).toEqual({
      accepted: false,
      reason: 'The check failed: connection refused',
      refusalsLeft: 2,
    });
    expect(gate.outcome).toBe('pending');
  });

  test('a check that rejects', async () => {
    const gate = createDoneGate({ check: () => Promise.reject(new Error('503')) });

    expect(await gate.decide('booked')).toMatchObject({
      accepted: false,
      reason: 'The check failed: 503',
    });
  });

  test('a check that times out, and its signal is aborted', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const gate = createDoneGate({
      timeoutMs: 50,
      check: (ctx) => {
        signal = ctx.signal;
        return new Promise<CheckResult>(() => {});
      },
    });

    const decision = gate.decide('booked');
    await vi.advanceTimersByTimeAsync(50);

    expect(await decision).toEqual({
      accepted: false,
      reason: 'The check timed out after 50 ms',
      refusalsLeft: 2,
    });
    expect(signal?.aborted).toBe(true);
  });

  test.each([
    ['undefined', undefined],
    ['true', true],
    ['a truthy ok', { ok: 'yes' }],
    ['a refusal with no reason', { ok: false }],
  ])('a check that returns %s', async (_label, value) => {
    // A check written in plain JavaScript can return anything.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const gate = createDoneGate({ check: () => value as CheckResult });

    expect(await gate.decide('booked')).toMatchObject({
      accepted: false,
      reason: 'The check returned an invalid result',
    });
  });
});

test('decisions on one gate run one at a time, in call order', async () => {
  const seen: string[] = [];
  const gate = createDoneGate({
    check: async ({ claim }) => {
      seen.push(`start ${claim}`);
      await new Promise((resolve) => setTimeout(resolve, claim === 'first' ? 20 : 0));
      seen.push(`end ${claim}`);
      return fail('not yet');
    },
  });

  await Promise.all([gate.decide('first'), gate.decide('second')]);

  expect(seen).toEqual(['start first', 'end first', 'start second', 'end second']);
});
