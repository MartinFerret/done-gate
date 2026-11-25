// done-gate for Mastra. All the logic is in the core gate: this file only turns it into a tool
// and a stop condition.
// Tools: https://mastra.ai/reference/tools/create-tool
// Stop conditions: https://mastra.ai/reference/agents/generate
import { createTool, type Tool, type ToolExecutionContext } from '@mastra/core/tools';
import type { Decision, DoneGate } from 'done-gate';
import { z } from 'zod';

export interface DoneToolInput {
  /** What the agent says it did. */
  readonly summary: string;
}

export interface DoneToolOptions {
  /** Replaces the default description shown to the model. */
  readonly description?: string;
}

/** The type `createTool` gives the "done" tool. Its result is a `Decision` from done-gate. */
export type DoneTool = Tool<
  { summary: string },
  unknown,
  unknown,
  unknown,
  ToolExecutionContext,
  'done'
>;

const DESCRIPTION =
  'Call this when the task is finished. The result says whether it was accepted. ' +
  'If it was refused, read the reason, fix the problem, then call it again.';

/**
 * The "done" tool. The model calls it to finish; the gate checks the real system and the model
 * gets the decision back: accepted, or refused with the reason.
 */
export function doneTool(gate: DoneGate, options: DoneToolOptions = {}): DoneTool {
  return createTool({
    id: 'done',
    description: options.description ?? DESCRIPTION,
    inputSchema: z.object({ summary: z.string().describe('One sentence: what was done.') }),
    execute: ({ summary }): Promise<Decision> => gate.decide(summary),
  });
}

/**
 * A stop condition: true once the gate has closed, as done or as not done. Read `gate.outcome`
 * after the run: only `done` is a success. A loop that stops for any other reason (`maxSteps`,
 * a model that answers without calling the tool) leaves it `pending`.
 */
export function gateClosed(gate: DoneGate): () => boolean {
  return () => gate.outcome !== 'pending';
}
