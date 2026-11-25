import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  TracerProvider,
} from '@opentelemetry/sdk-trace';
import { afterAll, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { createDoneGate } from './index.ts';

const exporter = new InMemorySpanExporter();
const provider = new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] });

beforeAll(() => {
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  trace.setGlobalTracerProvider(provider);
});
beforeEach(() => {
  exporter.reset();
});
afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

const spans = (): ReadableSpan[] => exporter.getFinishedSpans();
const onlySpan = (): ReadableSpan => {
  const [span, ...rest] = spans();
  if (!span || rest.length > 0) throw new Error(`expected one span, got ${spans().length}`);
  return span;
};

test('an accepted claim is one internal span with the verdict', async () => {
  const gate = createDoneGate({ name: 'booking', check: () => ({ ok: true }) });

  await gate.decide('Booked Tuesday 14:00 for Alice');

  const span = onlySpan();
  expect(span.name).toBe('done_gate.decide booking');
  expect(span.kind).toBe(SpanKind.INTERNAL);
  expect(span.instrumentationScope.name).toBe('done-gate');
  expect(span.status.code).toBe(SpanStatusCode.UNSET);
  expect(span.attributes).toEqual({
    'done_gate.name': 'booking',
    'done_gate.claim.summary': 'Booked Tuesday 14:00 for Alice',
    'done_gate.accepted': true,
    'done_gate.refusal.count': 0,
    'done_gate.refusals_left': 3,
    'done_gate.outcome': 'done',
  });
});

test('a refused claim carries the reason and the refusal count, and is not an error', async () => {
  const gate = createDoneGate({ check: () => ({ ok: false, reason: 'No booking found' }) });

  await gate.decide('booked');

  const span = onlySpan();
  expect(span.name).toBe('done_gate.decide done');
  expect(span.status.code).toBe(SpanStatusCode.UNSET);
  expect(span.attributes).toEqual({
    'done_gate.name': 'done',
    'done_gate.claim.summary': 'booked',
    'done_gate.accepted': false,
    'done_gate.reason': 'No booking found',
    'done_gate.refusal.count': 1,
    'done_gate.refusals_left': 2,
    'done_gate.outcome': 'pending',
  });
});

test('the refusal that ends the run says so', async () => {
  const gate = createDoneGate({ maxRefusals: 1, check: () => ({ ok: false, reason: 'nope' }) });

  await gate.decide('booked');

  expect(onlySpan().attributes).toMatchObject({
    'done_gate.accepted': false,
    'done_gate.refusals_left': 0,
    'done_gate.outcome': 'not_done',
  });
});

test('a check that throws marks the span as an error with error.type', async () => {
  const gate = createDoneGate({
    check: () => {
      throw new RangeError('connection refused');
    },
  });

  await gate.decide('booked');

  const span = onlySpan();
  expect(span.status).toEqual({
    code: SpanStatusCode.ERROR,
    message: 'The check failed: connection refused',
  });
  expect(span.attributes).toMatchObject({
    'done_gate.accepted': false,
    'done_gate.reason': 'The check failed: connection refused',
    'error.type': 'RangeError',
  });
});

test('a check that times out has error.type "timeout"', async () => {
  const gate = createDoneGate({ timeoutMs: 5, check: () => new Promise(() => {}) });

  await gate.decide('booked');

  expect(onlySpan().attributes['error.type']).toBe('timeout');
  expect(onlySpan().status.code).toBe(SpanStatusCode.ERROR);
});

test('recordContent: false leaves the claim out', async () => {
  const gate = createDoneGate({ recordContent: false, check: () => ({ ok: true }) });

  await gate.decide('Booked Tuesday 14:00 for Alice');

  expect(onlySpan().attributes).not.toHaveProperty('done_gate.claim.summary');
});

test('the span joins the active trace, and spans made by the check are its children', async () => {
  const tracer = trace.getTracer('test');
  const gate = createDoneGate({
    check: () => {
      tracer.startSpan('read bookings').end();
      return { ok: true };
    },
  });

  await tracer.startActiveSpan('execute_tool done', async (parent) => {
    await gate.decide('booked');
    parent.end();
  });

  const byName = (name: string): ReadableSpan => {
    const span = spans().find((s) => s.name === name);
    if (!span) throw new Error(`no span named ${name}`);
    return span;
  };
  const tool = byName('execute_tool done');
  const decision = byName('done_gate.decide done');
  const read = byName('read bookings');
  expect(decision.parentSpanContext?.spanId).toBe(tool.spanContext().spanId);
  expect(read.parentSpanContext?.spanId).toBe(decision.spanContext().spanId);
});

test('a decision after the gate closed is still traced, without running the check', async () => {
  const check = vi.fn(() => ({ ok: true }) as const);
  const gate = createDoneGate({ check });
  await gate.decide('booked');
  exporter.reset();

  await gate.decide('booked');

  expect(check).toHaveBeenCalledTimes(1);
  expect(onlySpan().attributes).toMatchObject({
    'done_gate.accepted': true,
    'done_gate.outcome': 'done',
  });
});
