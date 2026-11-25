import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createDoneGate } from 'done-gate';
import { expect, test } from 'vitest';
import { z } from 'zod';
import { doneTool, gateClosed } from './index.ts';
import { scripted, type Turn } from './scripted-model.ts';

/** The system the agent works on. The first write is lost, and the agent is told it worked. */
function bookingSystem() {
  const bookings: string[] = [];
  let writes = 0;
  return {
    bookings,
    book: createTool({
      id: 'book',
      description: 'Book a slot',
      inputSchema: z.object({ slot: z.string() }),
      execute: ({ slot }) => {
        writes += 1;
        if (writes > 1) bookings.push(slot);
        return Promise.resolve('Booked!');
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
  { text: 'Finished.' },
];

const agentWith = (turns: Turn[], tools: Record<string, ReturnType<typeof createTool>>) =>
  new Agent({
    id: 'booker',
    name: 'Booker',
    instructions: 'Book slots.',
    model: scripted(turns),
    tools,
  });

/** The outputs of the "done" tool, in call order. */
const doneOutputs = (result: {
  steps: { toolResults: { payload: { toolName: string; result?: unknown } }[] }[];
}) =>
  result.steps
    .flatMap((s) => s.toolResults)
    .filter((r) => r.payload.toolName === 'done')
    .map((r) => r.payload.result);

test('the failure: without a gate, "done" ends the run although nothing was booked', async () => {
  const system = bookingSystem();
  const plainDone = createTool({
    id: 'done',
    description: 'Call this when the task is finished.',
    inputSchema: z.object({ summary: z.string() }),
    execute: () => Promise.resolve('ok'),
  });
  const turns: Turn[] = [
    { call: 'book', input: { slot: 'Tuesday 14:00' } },
    { call: 'done', input: { summary: 'Booked Tuesday 14:00.' } },
    { text: 'Tuesday 14:00 is booked.' },
  ];
  const agent = agentWith(turns, { book: system.book, done: plainDone });

  const result = await agent.generate('Book Tuesday 14:00.', { maxSteps: 10 });

  expect(result.text).toBe('Tuesday 14:00 is booked.'); // the agent said done, the loop stopped
  expect(system.bookings).toEqual([]); // and nothing is booked
});

test('with the gate, the same "done" is refused, the agent rebooks, and the run ends for real', async () => {
  const system = bookingSystem();
  const gate = createDoneGate({ check: system.check });
  const agent = agentWith(bookThenDone, { book: system.book, done: doneTool(gate) });

  const result = await agent.generate('Book Tuesday 14:00.', {
    maxSteps: 10,
    stopWhen: gateClosed(gate),
  });

  expect(result.steps).toHaveLength(4);
  expect(doneOutputs(result)).toEqual([
    { accepted: false, reason: 'No booking found for Tuesday 14:00', refusalsLeft: 2 },
    { accepted: true },
  ]);
  expect(gate.outcome).toBe('done');
  expect(system.bookings).toEqual(['Tuesday 14:00']);
});

test('when the refusal budget runs out, the loop stops and the run is not done', async () => {
  const gate = createDoneGate({
    maxRefusals: 2,
    check: () => ({ ok: false, reason: 'No booking found' }),
  });
  const done = { call: 'done', input: { summary: 'Booked.' } };
  const agent = agentWith([done, done, done, done], { done: doneTool(gate) });

  const result = await agent.generate('Book Tuesday 14:00.', {
    maxSteps: 10,
    stopWhen: gateClosed(gate),
  });

  expect(result.steps).toHaveLength(2);
  expect(gate.outcome).toBe('not_done');
});

test('a model that stops without calling "done" leaves the gate pending: not done', async () => {
  const gate = createDoneGate({ check: () => ({ ok: true }) });
  const agent = agentWith([{ text: 'All booked!' }], { done: doneTool(gate) });

  await agent.generate('Book Tuesday 14:00.', { maxSteps: 10, stopWhen: gateClosed(gate) });

  expect(gate.outcome).toBe('pending');
});

test('the tool description can be replaced', () => {
  const gate = createDoneGate({ check: () => ({ ok: true }) });

  expect(doneTool(gate).description).toContain('finished');
  expect(doneTool(gate, { description: 'Finish.' }).description).toBe('Finish.');
});
