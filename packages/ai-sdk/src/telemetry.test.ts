import { OpenTelemetry } from '@ai-sdk/otel';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { generateText, isStepCount, registerTelemetry } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { createDoneGate } from '@martinferret/done-gate';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { doneTool, gateClosed } from './index.ts';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  trace.setGlobalTracerProvider(provider);
  registerTelemetry(new OpenTelemetry());
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

const doneCall = (id: string) => ({
  content: [
    {
      type: 'tool-call' as const,
      toolCallId: id,
      toolName: 'done',
      input: JSON.stringify({ summary: 'Booked Tuesday 14:00.' }),
    },
  ],
  finishReason: { unified: 'tool-calls' as const, raw: 'tool_calls' },
  usage: {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  },
  warnings: [],
});

test('with @ai-sdk/otel, each gate decision is a child of its execute_tool span, in the trace of the model calls', async () => {
  const answers = [{ ok: false, reason: 'No booking found' } as const, { ok: true } as const];
  const gate = createDoneGate({ check: () => answers.shift() ?? { ok: true } });

  await generateText({
    model: new MockLanguageModelV4({ doGenerate: [doneCall('call-1'), doneCall('call-2')] }),
    prompt: 'Book Tuesday 14:00.',
    tools: { done: doneTool(gate) },
    stopWhen: [gateClosed(gate), isStepCount(10)],
  });

  const spans = exporter.getFinishedSpans();
  const decisions = spans.filter((s) => s.name === 'done_gate.decide done');
  const toolSpans = spans.filter((s) => s.name === 'execute_tool done');
  expect(decisions.map((s) => s.attributes['done_gate.accepted'])).toEqual([false, true]);
  expect(toolSpans).toHaveLength(2);
  expect(decisions.map((s) => s.parentSpanContext?.spanId)).toEqual(
    toolSpans.map((s) => s.spanContext().spanId),
  );
  // One trace: the agent, its model calls, the tool calls and the decisions.
  expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
  expect(spans.filter((s) => s.name.startsWith('chat '))).toHaveLength(2);
});
