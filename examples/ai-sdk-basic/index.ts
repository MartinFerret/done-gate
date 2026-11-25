// The smallest runnable example: one task, run twice with the same model, prompt and tools.
//   1. without a gate: the loop stops as soon as the agent calls "done"
//   2. with done-gate: "done" is only accepted when the booking really exists
// Usage: pnpm start            (both)      pnpm start no-gate | gate
// Needs GROQ_API_KEY in ../../.env (free key, see .env.example).
import { groq } from '@ai-sdk/groq';
import { doneTool, gateClosed } from '@done-gate/ai-sdk';
import { generateText, hasToolCall, isStepCount, jsonSchema, tool } from 'ai';
import { createDoneGate } from 'done-gate';
import { type Booking, type BookingSystem, createBookingSystem } from './system.ts';
import { startTracing } from './tracing.ts';

const INSTRUCTIONS =
  'You complete tasks by calling tools. When the task is finished, call the "done" tool.';
const TASK = 'Book the Tuesday 14:00 slot for Alice.';
const MAX_STEPS = 10;

const reallyBooked = (system: BookingSystem): boolean =>
  system.list().some((b) => b.day === 'Tuesday' && b.time === '14:00' && b.name === 'Alice');

function bookingTools(system: BookingSystem) {
  return {
    bookSlot: tool({
      description: 'Book a slot for a person.',
      inputSchema: jsonSchema<Booking>({
        type: 'object',
        properties: { day: { type: 'string' }, time: { type: 'string' }, name: { type: 'string' } },
        required: ['day', 'time', 'name'],
        additionalProperties: false,
      }),
      execute: (booking) => system.book(booking),
    }),
    listBookings: tool({
      description: 'List the bookings that exist.',
      inputSchema: jsonSchema<Record<string, never>>({ type: 'object', properties: {} }),
      execute: () => system.list(),
    }),
  };
}

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
  const plainDone = tool({
    description: 'Call this when the task is finished.',
    inputSchema: jsonSchema<{ summary: string }>({
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    }),
    execute: () => 'ok',
  });

  console.log(`\n${withGate ? 'With done-gate' : 'Without a gate'}\nTask: ${TASK}\n`);
  const result = await generateText({
    model: groq('openai/gpt-oss-20b'),
    temperature: 0,
    // gpt-oss on Groq: when its reasoning is sent back in the history, its next tool call can come
    // out malformed ("done<|channel|>commentary") and Groq rejects it with a 400. Hiding the
    // reasoning keeps it out of the history. Same setting with and without the gate.
    providerOptions: { groq: { reasoningFormat: 'hidden' } },
    instructions: INSTRUCTIONS,
    prompt: TASK,
    tools: { ...bookingTools(system), done: withGate ? doneTool(gate) : plainDone },
    stopWhen: [withGate ? gateClosed(gate) : hasToolCall('done'), isStepCount(MAX_STEPS)],
    telemetry: { functionId: withGate ? 'booking-agent-with-gate' : 'booking-agent-no-gate' },
  });

  // The agent stopped with a text answer instead of calling "done". That answer is its claim:
  // check it once, so a finished task is not left unverified.
  let finalCheck = '';
  if (withGate && gate.outcome === 'pending' && result.text) {
    finalCheck = JSON.stringify(await gate.decide(result.text));
  }

  for (const [i, step] of result.steps.entries()) {
    for (const call of step.toolCalls) {
      const output = step.toolResults.find((r) => r.toolCallId === call.toolCallId)?.output;
      console.log(
        `${String(i + 1).padStart(3)}.  ${call.toolName} ${JSON.stringify(call.input)}  ->  ${JSON.stringify(output)}`,
      );
    }
    if (step.toolCalls.length === 0)
      console.log(`${String(i + 1).padStart(3)}.  (text) ${step.text}`);
  }
  const saidDone = withGate
    ? gate.outcome === 'done'
    : result.steps.some((s) => s.toolCalls.some((c) => c.toolName === 'done'));
  console.log(`\nReported done:    ${saidDone ? 'yes' : 'no'}`);
  console.log(`Really booked:    ${reallyBooked(system) ? 'yes' : 'NO'}`);
  if (finalCheck) console.log(`Final check:      the closing answer was checked: ${finalCheck}`);
  if (withGate) console.log(`Gate:             ${gate.outcome}, ${gate.refusals} refusal(s)`);
  console.log(`${result.steps.length} steps, ${result.totalUsage.totalTokens ?? 0} tokens`);
}

const flush = startTracing('example-ai-sdk-basic');
const mode = process.argv[2] ?? 'both';
if (mode !== 'gate') await run(false);
if (mode !== 'no-gate') await run(true);
await flush();
