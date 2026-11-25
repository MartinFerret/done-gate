// done-gate for the Vercel AI SDK 7. All the logic is in the core gate: this file only turns it
// into a tool and a stop condition.
// Tools: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling
// Stop conditions: https://ai-sdk.dev/docs/agents/loop-control
import { jsonSchema, type Tool, tool } from 'ai';
import type { Decision, DoneGate } from 'done-gate';

export interface DoneToolInput {
  /** What the agent says it did. */
  readonly summary: string;
}

export interface DoneToolOptions {
  /** Replaces the default description shown to the model. */
  readonly description?: string;
}

const DESCRIPTION =
  'Call this when the task is finished. The result says whether it was accepted. ' +
  'If it was refused, read the reason, fix the problem, then call it again.';

/**
 * The "done" tool. The model calls it to finish; the gate checks the real system and the model
 * gets the decision back: accepted, or refused with the reason.
 */
export function doneTool(
  gate: DoneGate,
  options: DoneToolOptions = {},
): Tool<DoneToolInput, Decision> {
  return tool({
    description: options.description ?? DESCRIPTION,
    inputSchema: jsonSchema<DoneToolInput>({
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One sentence: what was done.' },
      },
      required: ['summary'],
      additionalProperties: false,
    }),
    execute: ({ summary }): Promise<Decision> => gate.decide(summary),
  });
}

/**
 * A stop condition: true once the gate has closed, as done or as not done. Read `gate.outcome`
 * after the run: only `done` is a success. A loop that stops for any other reason (a step limit,
 * a model that answers without calling the tool) leaves it `pending`.
 */
export function gateClosed(gate: DoneGate): () => boolean {
  return () => gate.outcome !== 'pending';
}
