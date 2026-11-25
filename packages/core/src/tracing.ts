// One span per decision, made with @opentelemetry/api only.
// The API is an optional peer dependency: it is loaded on the first decision, and when it is not
// installed, or no SDK is registered, the gate simply does no tracing.
// https://opentelemetry.io/docs/languages/js/instrumentation/#create-spans
import type { Decision, Outcome } from './gate.ts';

type OtelApi = typeof import('@opentelemetry/api');

/** A decision, with what the span says about it. */
export interface TracedDecision {
  readonly decision: Decision;
  readonly outcome: Outcome;
  readonly refusals: number;
  readonly refusalsLeft: number;
  /** Set when the check itself failed: "timeout", "invalid_result" or the name of the error. */
  readonly errorType?: string;
}

export interface SpanInput {
  readonly gateName: string;
  /** Left out of the span when undefined. */
  readonly claim: string | undefined;
}

let loading: Promise<OtelApi | undefined> | undefined;

function loadApi(): Promise<OtelApi | undefined> {
  loading ??= import('@opentelemetry/api').then(
    (api) => api,
    () => undefined,
  );
  return loading;
}

/**
 * Runs `decide` inside a `done_gate.decide {name}` span. The span is active while the check runs,
 * so anything the check traces (an HTTP call, a query) becomes its child.
 */
export async function traceDecision(
  input: SpanInput,
  decide: () => Promise<TracedDecision>,
): Promise<Decision> {
  const api = await loadApi();
  if (!api) return (await decide()).decision;

  return api.trace
    .getTracer('done-gate')
    .startActiveSpan(
      `done_gate.decide ${input.gateName}`,
      { kind: api.SpanKind.INTERNAL, attributes: { 'done_gate.name': input.gateName } },
      async (span) => {
        try {
          const traced = await decide();
          const { decision } = traced;
          if (input.claim !== undefined) span.setAttribute('done_gate.claim.summary', input.claim);
          span.setAttribute('done_gate.accepted', decision.accepted);
          if (!decision.accepted) span.setAttribute('done_gate.reason', decision.reason);
          span.setAttribute('done_gate.refusal.count', traced.refusals);
          span.setAttribute('done_gate.refusals_left', traced.refusalsLeft);
          span.setAttribute('done_gate.outcome', traced.outcome);
          // A refusal is the gate working. Only a check that could not answer is an error.
          if (traced.errorType !== undefined && !decision.accepted) {
            span.setAttribute('error.type', traced.errorType);
            span.setStatus({ code: api.SpanStatusCode.ERROR, message: decision.reason });
          }
          return decision;
        } finally {
          span.end();
        }
      },
    );
}
