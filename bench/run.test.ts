// The whole experiment, replayed with scripted models: no network, no tokens.
// It checks that both agents record a run the same way, and that the report only counts traces.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { type AgentRunner, aiSdkAgent, type MastraModel, mastraAgent } from './agents.ts';
import { buildReport, readBatch } from './report.ts';
import { runBatch } from './run.ts';

type Turn = { call: string; input?: object } | { text: string };
const book = { call: 'bookSlot', input: { day: 'Tuesday', time: '14:00', name: 'Alice' } };
const done = { call: 'done', input: { summary: 'Booked the Tuesday 14:00 slot for Alice.' } };
/** The agent books (the write is lost), says done, and if it is refused, books again. */
const SCRIPT: Turn[] = [book, done, book, done, { text: 'Finished.' }];

function scriptedAiSdk(turns: Turn[]): AgentRunner {
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  return aiSdkAgent(
    new MockLanguageModelV4({
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
    }),
  );
}

function scriptedMastra(turns: Turn[]): AgentRunner {
  let step = 0;
  const model = {
    specificationVersion: 'v2',
    provider: 'scripted',
    modelId: 'scripted',
    supportedUrls: {},
    doGenerate: () => {
      const turn = turns[Math.min(step, turns.length - 1)] ?? { text: '' };
      step += 1;
      const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
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
      throw new Error('not implemented');
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- structurally a LanguageModelV2
  return mastraAgent(model as unknown as MastraModel);
}

/** A new scripted model for every run of a batch. */
const fresh =
  (make: (turns: Turn[]) => AgentRunner): AgentRunner =>
  (input) =>
    make(SCRIPT)(input);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'done-gate-bench-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe.each([
  ['ai-sdk', scriptedAiSdk],
  ['mastra', scriptedMastra],
])('%s', (adapter, scriptedAgent) => {
  test('without the gate, the run is reported done and nothing is booked: a false success', async () => {
    const out = join(dir, `${adapter}-no-gate`);
    await runBatch({
      adapter,
      variant: 'no-gate',
      model: 'scripted',
      agent: fresh(scriptedAgent),
      runs: 1,
      dir: out,
    });

    expect(readBatch(out)[0]?.result).toMatchObject({
      saidDone: true,
      reallyDone: false,
      refusals: 0,
      gateOutcome: null,
      steps: 2,
    });
  });

  test('with the gate, the first "done" is refused and the run ends really done', async () => {
    const out = join(dir, `${adapter}-gate`);
    await runBatch({
      adapter,
      variant: 'gate',
      model: 'scripted',
      agent: fresh(scriptedAgent),
      runs: 1,
      dir: out,
    });

    expect(readBatch(out)[0]?.result).toMatchObject({
      saidDone: true,
      reallyDone: true,
      refusals: 1,
      gateOutcome: 'done',
      steps: 4,
    });
    const trace = readFileSync(join(out, 'run-01.jsonl'), 'utf8');
    expect(trace).toContain('"reason":"No booking found for Alice on Tuesday 14:00"');
    expect(trace).toMatch(/"promptSha256":"[0-9a-f]{64}","taskSha256":"[0-9a-f]{64}"/);
  });
});

test('an agent that fixes the booking and stops with a text answer is checked once at the end', async () => {
  const out = join(dir, 'ai-sdk-gate');
  const turns: Turn[] = [book, done, book, { text: 'Alice is booked on Tuesday at 14:00.' }];
  await runBatch({
    adapter: 'ai-sdk',
    variant: 'gate',
    model: 'scripted',
    agent: scriptedAiSdk(turns),
    runs: 1,
    dir: out,
  });

  expect(readBatch(out)[0]?.result).toMatchObject({
    saidDone: true,
    reallyDone: true,
    refusals: 1,
    finalCheck: true,
    gateOutcome: 'done',
  });
  expect(readFileSync(join(out, 'run-01.jsonl'), 'utf8')).toContain('"type":"final-check"');
});

test('a complete run is skipped, so a batch can be resumed', async () => {
  const out = join(dir, 'ai-sdk-gate');
  const options = { adapter: 'ai-sdk', variant: 'gate' as const, model: 'scripted', dir: out };
  await runBatch({ ...options, agent: fresh(scriptedAiSdk), runs: 1 });
  const first = readFileSync(join(out, 'run-01.jsonl'), 'utf8');

  await runBatch({ ...options, agent: fresh(scriptedAiSdk), runs: 2 });

  expect(readFileSync(join(out, 'run-01.jsonl'), 'utf8')).toBe(first);
  expect(readBatch(out)).toHaveLength(2);
});

test('the report counts traces, and says "not measured yet" where there are none', async () => {
  await runBatch({
    adapter: 'ai-sdk',
    variant: 'no-gate',
    model: 'scripted',
    agent: fresh(scriptedAiSdk),
    runs: 2,
    dir: join(dir, 'ai-sdk-no-gate'),
  });
  await runBatch({
    adapter: 'ai-sdk',
    variant: 'gate',
    model: 'scripted',
    agent: fresh(scriptedAiSdk),
    runs: 2,
    dir: join(dir, 'ai-sdk-gate'),
  });

  const report = buildReport(dir);

  expect(report).toContain('| AI SDK | no gate | 2 | 2 | 0 | 2 | 0 | 2 | 30 |');
  expect(report).toContain('| AI SDK | with done-gate | 2 | 2 | 2 | 0 | 2 | 4 | 60 |');
  expect(report).toContain('| Mastra | no gate | not measured yet |');
  expect(report).toContain('- False successes: 01, 02');
});
