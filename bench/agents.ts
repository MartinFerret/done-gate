// The two agents of the experiment: the same task, tools, prompt and model, once through the
// Vercel AI SDK and once through Mastra. Each can run with done-gate or without it.
// Without the gate, "done" is a plain tool and the run stops as soon as it is called.
import {
  doneTool as aiSdkDoneTool,
  gateClosed as aiSdkGateClosed,
} from '@mferret/done-gate-ai-sdk';
import {
  doneTool as mastraDoneTool,
  gateClosed as mastraGateClosed,
} from '@mferret/done-gate-mastra';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { generateText, hasToolCall, isStepCount, jsonSchema, type LanguageModel, tool } from 'ai';
import type { DoneGate } from '@mferret/done-gate';
import { z } from 'zod';
import type { Booking, BookingSystem } from './system.ts';

export const MAX_STEPS = 10;
export const TEMPERATURE = 0;
const PLAIN_DONE = 'Call this when the task is finished.';

/** One step of a run: a tool call with its result, or a text answer. */
export type StepRecord =
  | { readonly tool: string; readonly input: unknown; readonly output: unknown }
  | { readonly text: string };

export interface AgentRun {
  readonly steps: StepRecord[];
  readonly tokens: number;
}

export interface AgentInput {
  readonly instructions: string;
  readonly task: string;
  readonly system: BookingSystem;
  /** With a gate, "done" goes through it. Without, "done" is accepted as said. */
  readonly gate: DoneGate | undefined;
}

export type AgentRunner = (input: AgentInput) => Promise<AgentRun>;

/** https://ai-sdk.dev/docs/agents/loop-control */
export function aiSdkAgent(model: LanguageModel): AgentRunner {
  return async ({ instructions, task, system, gate }) => {
    const done = gate
      ? aiSdkDoneTool(gate)
      : tool({
          description: PLAIN_DONE,
          inputSchema: jsonSchema<{ summary: string }>({
            type: 'object',
            properties: { summary: { type: 'string' } },
            required: ['summary'],
          }),
          execute: () => 'ok',
        });
    const result = await generateText({
      model,
      temperature: TEMPERATURE,
      instructions,
      // gpt-oss on Groq: when its reasoning is sent back in the history, its next tool call can come
      // out malformed ("done<|channel|>commentary") and Groq rejects it with a 400. Hiding the
      // reasoning keeps it out of the history. Same setting with and without the gate.
      providerOptions: { groq: { reasoningFormat: 'hidden' } },
      prompt: task,
      tools: {
        bookSlot: tool({
          description: 'Book a slot for a person.',
          inputSchema: jsonSchema<Booking>({
            type: 'object',
            properties: {
              day: { type: 'string' },
              time: { type: 'string' },
              name: { type: 'string' },
            },
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
        done,
      },
      stopWhen: [gate ? aiSdkGateClosed(gate) : hasToolCall('done'), isStepCount(MAX_STEPS)],
    });

    const steps: StepRecord[] = result.steps.flatMap((step): StepRecord[] =>
      step.toolCalls.length === 0
        ? [{ text: step.text }]
        : step.toolCalls.map((call) => ({
            tool: call.toolName,
            input: call.input,
            output: step.toolResults.find((r) => r.toolCallId === call.toolCallId)?.output,
          })),
    );
    return { steps, tokens: result.totalUsage.totalTokens ?? 0 };
  };
}

/** A Mastra model: a router string such as "groq/openai/gpt-oss-20b", or a model instance. */
export type MastraModel = ConstructorParameters<typeof Agent>[0]['model'];

/** https://mastra.ai/reference/agents/generate */
export function mastraAgent(model: MastraModel): AgentRunner {
  return async ({ instructions, task, system, gate }) => {
    // Without a gate, the run stops right after the step in which "done" was called.
    let claimed = false;
    const done = gate
      ? mastraDoneTool(gate)
      : createTool({
          id: 'done',
          description: PLAIN_DONE,
          inputSchema: z.object({ summary: z.string() }),
          execute: () => {
            claimed = true;
            return Promise.resolve('ok');
          },
        });
    const agent = new Agent({
      id: 'booking-agent',
      name: 'booking-agent',
      instructions,
      model,
      tools: {
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
        done,
      },
    });

    const result = await agent.generate(task, {
      maxSteps: MAX_STEPS,
      modelSettings: { temperature: TEMPERATURE },
      // gpt-oss on Groq: when its reasoning is sent back in the history, its next tool call can come
      // out malformed ("done<|channel|>commentary") and Groq rejects it with a 400. Hiding the
      // reasoning keeps it out of the history. Same setting with and without the gate.
      providerOptions: { groq: { reasoningFormat: 'hidden' } },
      stopWhen: gate ? mastraGateClosed(gate) : () => claimed,
    });

    const steps: StepRecord[] = result.steps.flatMap((step): StepRecord[] =>
      step.toolCalls.length === 0
        ? [{ text: step.text }]
        : step.toolCalls.map((call) => ({
            tool: call.payload.toolName,
            input: call.payload.args,
            output: step.toolResults.find((r) => r.payload.toolCallId === call.payload.toolCallId)
              ?.payload.result,
          })),
    );
    return { steps, tokens: result.totalUsage.totalTokens ?? 0 };
  };
}
