// Test helper: a scripted model for Mastra. Each turn is the tool call (or the text) of one step.
// It implements the AI SDK "v2" language model interface by hand, which Mastra accepts. No network.
// Only `doGenerate` is implemented: that is what `agent.generate` calls.
export type Turn = { call: string; input?: object } | { text: string };

const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };

export function scripted(turns: Turn[]): never {
  let step = 0;
  const next = (): Turn => {
    const turn = turns[Math.min(step, turns.length - 1)] ?? { text: '' };
    step += 1;
    return turn;
  };
  const model = {
    specificationVersion: 'v2',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    doGenerate: () => {
      const turn = next();
      return Promise.resolve(
        'text' in turn
          ? {
              content: [{ type: 'text', text: turn.text }],
              finishReason: 'stop',
              usage,
              warnings: [],
            }
          : {
              content: [
                {
                  type: 'tool-call',
                  toolCallId: `call-${step}`,
                  toolName: turn.call,
                  input: JSON.stringify(turn.input ?? {}),
                },
              ],
              finishReason: 'tool-calls',
              usage,
              warnings: [],
            },
      );
    },
    doStream: () => {
      throw new Error('scripted model: streaming is not implemented');
    },
  };
  // The hand-written model is only structurally a LanguageModelV2.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return model as never;
}
