# @mferret/done-gate

## 0.1.0

### Minor Changes

- First public release.
  
  - `@mferret/done-gate`: `createDoneGate`, a gate that accepts a "done" claim only when a check against the real system passes. Refusals carry the reason, a refusal budget ends the run as not done, and a check that throws or times out is a refusal. One OpenTelemetry span per decision.
  - `@mferret/done-gate-ai-sdk`: `doneTool` and `gateClosed` for the Vercel AI SDK 7.
  - `@mferret/done-gate-mastra`: `doneTool` and `gateClosed` for Mastra 1.x.
