# Conformance

The spans done-gate emits are validated with [OpenTelemetry Weaver](https://github.com/open-telemetry/weaver)
live-check, the same tool [semantic-conventions-conformance](https://github.com/open-telemetry/semantic-conventions-conformance) uses.

```sh
pnpm build
pnpm conformance        # needs Docker
```

What happens:

1. Weaver `v0.28.0` (image pinned by digest in `run.sh`) starts and listens for OTLP over gRPC.
2. `emit.ts` runs every case of the gate with scripted checks (accepted, refused, budget used up,
   check that throws, times out or returns something invalid, content recording off) and exports
   the spans. No model is called.
3. Weaver checks each span and attribute against `registry/`, writes `report/live_check.json`, and
   `summarize.ts` writes `report/summary.md`.
4. The run fails on any violation, or if a span was not recognised as a gate decision.

## What it is checked against

`registry/` is a small registry that depends on
[semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) at tag
`v0.1.0` (commit `d0e74ba6c48bcc4ded473b1828a8212f06b23753`), which itself depends on the core
semantic conventions `v1.45.0`.

The GenAI conventions have no span for a verification or a "done" decision, so `registry/done-gate.yaml`
declares the `done_gate.decide` span and its `done_gate.*` attributes. Without that declaration
Weaver reports every `done_gate.*` attribute as a violation ("does not exist in the registry").
The check therefore proves three things: the gate emits exactly what it documents (names, types,
required attributes), it puts nothing in the `gen_ai.` namespace, and `error.type` is used as the
core conventions define it.

It does not validate the spans of the frameworks (`invoke_agent`, `chat`, `execute_tool`): those
are emitted by the AI SDK and Mastra, not by done-gate.

## Findings

The full list is in [report/summary.md](report/summary.md). There are no violations. What Weaver
does report:

- `not_stable` on every `done_gate.*` attribute: the done-gate registry is declared at stability
  "development", like the whole GenAI registry it builds on.
- `unexpected_attribute` on `service.name`: a resource attribute set by the test emitter, defined
  in the core conventions and not declared by this registry.
- `undefined_enum_variant` on `error.type` values: the core conventions document only `_OTHER`
  and expect custom values.
- "not present" notes for attributes that are conditional (`done_gate.reason` on an accepted
  claim, `error.type` when the check answered) or opt-in.

A deliberately wrong span (a string in `done_gate.accepted`, an undeclared attribute, missing
required attributes) was sent once by hand to confirm that the run fails: 5 violations, exit code 1.
