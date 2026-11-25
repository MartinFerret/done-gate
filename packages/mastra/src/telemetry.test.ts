import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { Observability } from '@mastra/observability';
import { OtelBridge } from '@mastra/otel-bridge';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { createDoneGate } from '@mferret/done-gate';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { doneTool, gateClosed } from './index.ts';
import { scripted } from './scripted-model.ts';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  trace.setGlobalTracerProvider(provider);
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

test('with @mastra/otel-bridge, each gate decision is a child of its execute_tool span, in the trace of the model calls', async () => {
  const answers = [{ ok: false, reason: 'No booking found' } as const, { ok: true } as const];
  const gate = createDoneGate({ check: () => answers.shift() ?? { ok: true } });
  const done = { call: 'done', input: { summary: 'Booked Tuesday 14:00.' } };
  const agent = new Agent({
    id: 'booker',
    name: 'Booker',
    instructions: 'Book slots.',
    model: scripted([done, done]),
    tools: { done: doneTool(gate) },
  });
  // Mastra traces with its own system. The bridge turns its spans into OpenTelemetry spans and
  // makes them the active context while a tool runs.
  const mastra = new Mastra({
    agents: { booker: agent },
    observability: new Observability({
      configs: { default: { serviceName: 'test', bridge: new OtelBridge() } },
    }),
  });

  await mastra.getAgent('booker').generate('Book Tuesday 14:00.', {
    maxSteps: 10,
    stopWhen: gateClosed(gate),
  });
  await provider.forceFlush();

  const spans = exporter.getFinishedSpans();
  const decisions = spans.filter((s) => s.name === 'done_gate.decide done');
  const toolSpans = spans.filter((s) => s.name === 'execute_tool done');
  expect(decisions.map((s) => s.attributes['done_gate.accepted'])).toEqual([false, true]);
  expect(toolSpans).toHaveLength(2);
  expect(decisions.map((s) => s.parentSpanContext?.spanId)).toEqual(
    toolSpans.map((s) => s.spanContext().spanId),
  );
  expect(new Set(spans.map((s) => s.spanContext().traceId)).size).toBe(1);
  expect(spans.filter((s) => s.name.startsWith('chat '))).toHaveLength(2);
});
