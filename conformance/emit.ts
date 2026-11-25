// Emits every kind of span done-gate can produce, over OTLP/gRPC, for Weaver live-check.
// No model and no network apart from the OTLP export: the checks are scripted.
// Usage: node emit.ts   (OTLP endpoint from OTEL_EXPORTER_OTLP_ENDPOINT, default http://localhost:4317)
// https://opentelemetry.io/docs/languages/js/exporters/#otlp
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { type Check, createDoneGate } from '@martinferret/done-gate';

const url = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4317';
const provider = new TracerProvider({
  resource: resourceFromAttributes({ 'service.name': 'done-gate-conformance' }),
  spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url }) })],
});
context.setGlobalContextManager(new AsyncLocalStorageContextManager());
trace.setGlobalTracerProvider(provider);

const pass: Check = () => ({ ok: true });
const refuse: Check = () => ({ ok: false, reason: 'No booking found for Alice on Tuesday 14:00' });
const claim = 'Booked the Tuesday 14:00 slot for Alice.';

// Cases 1 and 2 opt in to recording the claim, the others use the default (not recorded).
// 1. Accepted on the first claim, then asked again after the gate closed.
const accepted = createDoneGate({ name: 'booking', check: pass, recordContent: true });
await accepted.decide(claim);
await accepted.decide(claim);

// 2. Refused, then accepted.
const answers = [refuse, pass];
const retried = createDoneGate({
  name: 'booking',
  check: (c) => (answers.shift() ?? pass)(c),
  recordContent: true,
});
await retried.decide(claim);
await retried.decide(claim);

// 3. Refused until the budget runs out, then asked again.
const exhausted = createDoneGate({ name: 'booking', check: refuse, maxRefusals: 2 });
await exhausted.decide(claim);
await exhausted.decide(claim);
await exhausted.decide(claim);

// 4. The check cannot answer: it throws, times out, returns something invalid.
const throwing = createDoneGate({
  name: 'booking',
  check: () => {
    throw new TypeError('fetch failed');
  },
});
await throwing.decide(claim);
const hanging = createDoneGate({
  name: 'booking',
  timeoutMs: 20,
  check: () => new Promise(() => {}),
});
await hanging.decide(claim);
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const invalid = createDoneGate({ name: 'booking', check: (() => 'yes') as unknown as Check });
await invalid.decide(claim);

// 5. Defaults: no claim recorded, default gate name.
const quiet = createDoneGate({ check: refuse });
await quiet.decide(claim);

await provider.shutdown();
console.log(`Emitted 11 decisions to ${url}`);
