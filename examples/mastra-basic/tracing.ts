// Optional: with OTEL_EXPORTER_OTLP_ENDPOINT set (see examples/tracing), Mastra's spans and the
// decisions of the gate are exported over OTLP/gRPC, in one trace per run.
// Mastra traces with its own system. @mastra/otel-bridge (experimental) turns its spans into
// OpenTelemetry spans and makes them the active context while a tool runs, which is what puts
// the gate span under `execute_tool done`. @mastra/otel-exporter does not do that.
// https://mastra.ai/integrations/observability/opentelemetry
import { Observability } from '@mastra/observability';
import { OtelBridge } from '@mastra/otel-bridge';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { BatchSpanProcessor, TracerProvider } from '@opentelemetry/sdk-trace';

export interface Tracing {
  /** Pass to `new Mastra({ observability })`. Undefined when tracing is off. */
  readonly observability: Observability | undefined;
  readonly flush: () => Promise<void>;
}

/** Starts tracing when an OTLP endpoint is configured. */
export function startTracing(serviceName: string): Tracing {
  const url = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'];
  if (!url) return { observability: undefined, flush: () => Promise.resolve() };

  const provider = new TracerProvider({
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    spanProcessors: [new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url }) })],
  });
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  trace.setGlobalTracerProvider(provider);
  // Note: Mastra records prompts, tool arguments and results by default.
  // Turn that off per call with `tracingOptions: { hideInput: true, hideOutput: true }`.
  const observability = new Observability({
    configs: { default: { serviceName, bridge: new OtelBridge() } },
  });
  return { observability, flush: () => provider.shutdown() };
}
