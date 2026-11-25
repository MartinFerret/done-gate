import { generateText, hasToolCall, isStepCount, jsonSchema, tool } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createDoneGate } from '@martinferret/done-gate';
import { expect, test } from 'vitest';
import { doneTool, gateClosed } from './index.ts';

// A scripted model: each entry is the tool call (or the text) of one step. No network.
type Turn = { call: string; input?: object } | { text: string };
const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 5, text: 5, reasoning: 0 },
};
function scripted(turns: Turn[]): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doGenerate: turns.map((turn, i) =>
      'text' in turn
        ? {
            content: [{ type: 'text' as const, text: turn.text }],
            finishReason: { unified: 'stop' as const, raw: 'stop' },
            usage,
            warnings: [],
          }
        : {
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: `call-${i + 1}`,
                toolName: turn.call,
                input: JSON.stringify(turn.input ?? {}),
              },
            ],
            finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
            usage,
            warnings: [],
          },
    ),
  });
}

/** The system the agent works on. The first write is lost, and the agent is told it worked. */
function bookingSystem() {
  const bookings: string[] = [];
  let writes = 0;
  return {
    bookings,
    book: tool({
      description: 'Book a slot',
      inputSchema: jsonSchema<{ slot: string }>({
        type: 'object',
        properties: { slot: { type: 'string' } },
        required: ['slot'],
      }),
      execute: ({ slot }) => {
        writes += 1;
        if (writes > 1) bookings.push(slot);
        return 'Booked!';
      },
    }),
    check: () =>
      bookings.includes('Tuesday 14:00')
        ? ({ ok: true } as const)
        : ({ ok: false, reason: 'No booking found for Tuesday 14:00' } as const),
  };
}

const bookThenDone: Turn[] = [
  { call: 'book', input: { slot: 'Tuesday 14:00' } },
  { call: 'done', input: { summary: 'Booked Tuesday 14:00.' } },
  { call: 'book', input: { slot: 'Tuesday 14:00' } },
  { call: 'done', input: { summary: 'Booked Tuesday 14:00 again.' } },
];

test('the failure: without a gate, "done" ends the run although nothing was booked', async () => {
  const system = bookingSystem();
  const plainDone = tool({
    description: 'Call this when the task is finished.',
    inputSchema: jsonSchema<{ summary: string }>({
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    }),
    execute: () => 'ok',
  });

  const result = await generateText({
    model: scripted(bookThenDone),
    prompt: 'Book Tuesday 14:00.',
    tools: { book: system.book, done: plainDone },
    stopWhen: [hasToolCall('done'), isStepCount(10)],
  });

  expect(result.steps).toHaveLength(2); // the agent said done, the loop stopped
  expect(system.bookings).toEqual([]); // and nothing is booked
});

test('with the gate, the same "done" is refused, the agent rebooks, and the run ends for real', async () => {
  const system = bookingSystem();
  const gate = createDoneGate({ check: system.check });

  const result = await generateText({
    model: scripted(bookThenDone),
    prompt: 'Book Tuesday 14:00.',
    tools: { book: system.book, done: doneTool(gate) },
    stopWhen: [gateClosed(gate), isStepCount(10)],
  });

  expect(result.steps).toHaveLength(4);
  expect(result.steps[1]?.toolResults[0]?.output).toEqual({
    accepted: false,
    reason: 'No booking found for Tuesday 14:00',
    refusalsLeft: 2,
  });
  expect(result.steps[3]?.toolResults[0]?.output).toEqual({ accepted: true });
  expect(gate.outcome).toBe('done');
  expect(system.bookings).toEqual(['Tuesday 14:00']);
});

test('when the refusal budget runs out, the loop stops and the run is not done', async () => {
  const gate = createDoneGate({
    maxRefusals: 2,
    check: () => ({ ok: false, reason: 'No booking found' }),
  });
  const done = { call: 'done', input: { summary: 'Booked.' } };

  const result = await generateText({
    model: scripted([done, done, done, done]),
    prompt: 'Book Tuesday 14:00.',
    tools: { done: doneTool(gate) },
    stopWhen: [gateClosed(gate), isStepCount(10)],
  });

  expect(result.steps).toHaveLength(2);
  expect(gate.outcome).toBe('not_done');
});

test('a model that stops without calling "done" leaves the gate pending: not done', async () => {
  const gate = createDoneGate({ check: () => ({ ok: true }) });

  await generateText({
    model: scripted([{ text: 'All booked!' }]),
    prompt: 'Book Tuesday 14:00.',
    tools: { done: doneTool(gate) },
    stopWhen: [gateClosed(gate), isStepCount(10)],
  });

  expect(gate.outcome).toBe('pending');
});

test('the tool description can be replaced', () => {
  const gate = createDoneGate({ check: () => ({ ok: true }) });

  expect(doneTool(gate).description).toContain('finished');
  expect(doneTool(gate, { description: 'Finish.' }).description).toBe('Finish.');
});
