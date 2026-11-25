# Tracing demo

One agent run in a local trace viewer: the model calls, a refused "done" with its reason, then the
accepted one, in a single trace.

```sh
pnpm build                               # from the repo root, once
cd examples/tracing
pnpm viewer                              # starts Arize Phoenix in Docker
pnpm demo                                # one AI SDK run with done-gate, exported over OTLP/gRPC
open http://localhost:6006               # project "default", latest trace
pnpm screenshot                          # writes docs/trace.png (needs `npx playwright install chromium`)
pnpm viewer:stop
```

`pnpm demo` needs `GROQ_API_KEY` in the repo's `.env`. For Mastra, run its example the same way:
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 pnpm --filter example-mastra-basic start gate`.

## Why Phoenix

Both Jaeger v2 and Phoenix are free, run locally in one container and accept OTLP over gRPC. Sent
the same spans, Phoenix recognised the GenAI conventions with no extra instrumentation (agent, model
and tool spans are typed, token counts are shown) and kept the `done_gate.*` attributes as they
are. Jaeger shows every attribute as a plain tag. For a demo about agent runs, Phoenix reads better.
The spans themselves are plain OpenTelemetry: any OTLP backend works.

The container runs with `PHOENIX_ENABLE_AUTH=false`: Phoenix 22 requires a login by default, which
a local demo does not need. Do not expose it.

## What is recorded

Prompts, tool arguments and tool results are in the trace: the AI SDK and Mastra both record content
by default. The gate records its verdict and the reason of a refusal, and not the claim, unless
`recordContent: true` is set. See "Content" in [docs/design.md](../../docs/design.md).
