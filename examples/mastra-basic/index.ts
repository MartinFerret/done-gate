// The smallest runnable example: one task, run twice with the same model, prompt and tools.
//   1. without a gate: the run ends when the agent stops, whatever it claims
//   2. with done-gate: "done" is only accepted when the booking really exists
// Usage: pnpm start            (both)      pnpm start no-gate | gate
// Needs GROQ_API_KEY in ../../.env (free key, see .env.example).
import { doneTool, gateClosed } from '@mferret/done-gate-mastra';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createDoneGate } from '@mferret/done-gate';
import { z } from 'zod';
import { type BookingSystem, createBookingSystem } from './system.ts';
import { startTracing } from './tracing.ts';

const INSTRUCTIONS =
  'You complete tasks by calling tools. When the task is finished, call the "done" tool.';
const TASK = 'Book the Tuesday 14:00 slot for Alice.';
const MAX_STEPS = 10;

const reallyBooked = (system: BookingSystem): boolean =>
  system.list().some((b) => b.day === 'Tuesday' && b.time === '14:00' && b.name === 'Alice');

function bookingTools(system: BookingSystem) {
  return {
    bookSlot: createTool({
      id: 'bookSlot',
      description: 'Book a slot for a person.',
      inputSchema: z.object({ day: z.string(), time: z.string(), name: z.string() }),
      execute: (booking) => Promise.resolve(system.book(booking)),
    }),
    listBookings: createTool({
      id: 'listBookings',
      description: 'List the bookings that exist.',
      inputSchema: z.object({}),
      execute: () => Promise.resolve(system.list()),
    }),
  };
}

const tracing = startTracing('example-mastra-basic');

async function run(withGate: boolean): Promise<void> {
  const system = createBookingSystem();
  // The check reads the system itself, not what the agent or a tool said.
  const gate = createDoneGate({
    name: 'booking',
    check: () =>
      reallyBooked(system)
        ? { ok: true }
        : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
  });
  // Without a gate, the run stops right after the step in which "done" was called.
  let claimed = false;
  const plainDone = createTool({
    id: 'done',
    description: 'Call this when the task is finished.',
    inputSchema: z.object({ summary: z.string() }),
    execute: () => {
      claimed = true;
      return Promise.resolve('ok');
    },
  });
  const agent = new Agent({
    id: withGate ? 'booking-agent-with-gate' : 'booking-agent-no-gate',
    name: withGate ? 'booking-agent-with-gate' : 'booking-agent-no-gate',
    instructions: INSTRUCTIONS,
    model: 'groq/openai/gpt-oss-20b',
    tools: { ...bookingTools(system), done: withGate ? doneTool(gate) : plainDone },
  });
  // A Mastra instance is only needed for tracing.
  const mastra = new Mastra({
    agents: { agent },
    ...(tracing.observability && { observability: tracing.observability }),
  });

  console.log(`\n${withGate ? 'With done-gate' : 'Without a gate'}\nTask: ${TASK}\n`);
  const result = await mastra.getAgent('agent').generate(TASK, {
    maxSteps: MAX_STEPS,
    modelSettings: { temperature: 0 },
    // gpt-oss on Groq: when its reasoning is sent back in the history, its next tool call can come
    // out malformed ("done<|channel|>commentary") and Groq rejects it with a 400. Hiding the
    // reasoning keeps it out of the history. Same setting with and without the gate.
    providerOptions: { groq: { reasoningFormat: 'hidden' } },
    stopWhen: withGate ? gateClosed(gate) : () => claimed,
  });

  // The agent stopped with a text answer instead of calling "done". That answer is its claim:
  // check it once, so a finished task is not left unverified.
  let finalCheck = '';
  if (withGate && gate.outcome === 'pending' && result.text) {
    finalCheck = JSON.stringify(await gate.decide(result.text));
  }

  for (const [i, step] of result.steps.entries()) {
    for (const call of step.toolCalls) {
      const output = step.toolResults.find((r) => r.payload.toolCallId === call.payload.toolCallId)
        ?.payload.result;
      console.log(
        `${String(i + 1).padStart(3)}.  ${call.payload.toolName} ${JSON.stringify(call.payload.args)}  ->  ${JSON.stringify(output)}`,
      );
    }
    if (step.toolCalls.length === 0)
      console.log(`${String(i + 1).padStart(3)}.  (text) ${step.text}`);
  }
  console.log(
    `\nReported done:    ${(withGate ? gate.outcome === 'done' : claimed) ? 'yes' : 'no'}`,
  );
  console.log(`Really booked:    ${reallyBooked(system) ? 'yes' : 'NO'}`);
  if (finalCheck) console.log(`Final check:      the closing answer was checked: ${finalCheck}`);
  if (withGate) console.log(`Gate:             ${gate.outcome}, ${gate.refusals} refusal(s)`);
  console.log(`${result.steps.length} steps, ${result.totalUsage.totalTokens ?? 0} tokens`);
}

const mode = process.argv[2] ?? 'both';
if (mode !== 'gate') await run(false);
if (mode !== 'no-gate') await run(true);
await tracing.flush();
