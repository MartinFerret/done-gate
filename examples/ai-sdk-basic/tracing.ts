// Optional: with OTEL_EXPORTER_OTLP_ENDPOINT set (see examples/tracing), the model calls of the
// AI SDK and the decisions of the gate are exported over OTLP/gRPC, in one trace per run.
// https://ai-sdk.dev/docs/ai-sdk-core/telemetry
import { OpenTelemetry } from '@ai-sdk/otel';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';
import { registerTelemetry } from 'ai';

/** Starts tracing when an OTLP endpoint is configured. Returns a function that flushes it. */
export function startTracing(serviceName: string): () => Promise<void> {
  const url = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!url) return () => Promise.resolve();

  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url }) })],
  });
  // The context manager is what makes the gate span a child of the SDK's execute_tool span.
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  trace.setGlobalTracerProvider(provider);
  // Note: once registered, the AI SDK records prompts, tool arguments and results by default.
  // Turn that off per call with `telemetry: { recordInputs: false, recordOutputs: false }`.
  registerTelemetry(new OpenTelemetry());
  return () => provider.shutdown();
}
