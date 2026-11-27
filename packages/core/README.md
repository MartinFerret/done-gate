# @mferret/done-gate

An AI agent says "done". done-gate asks the real system whether that is true before the run is allowed to end. If it is not, the agent gets the reason back and keeps working.

```sh
npm install @mferret/done-gate
```

```ts
import { createDoneGate } from '@mferret/done-gate';

const gate = createDoneGate({
  // Read the real system. Not the model's answer, not a tool's return value.
  check: async () =>
    (await bookingExists('Alice', 'Tuesday 14:00'))
      ? { ok: true }
      : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
});

const decision = await gate.decide('Booked Tuesday 14:00 for Alice');
// { accepted: true } or { accepted: false, reason, refusalsLeft }
gate.outcome; // 'pending' | 'done' | 'not_done'
```

- A refused claim carries the reason of the check, to hand back to the model.
- After `maxRefusals` refusals (default 3) the run ends as `not_done`, never as a success.
- A check that throws, times out (`timeoutMs`, default 10 000) or returns something invalid is a refusal, never a pass.
- Each decision is one OpenTelemetry span, `done_gate.decide {name}`. `@opentelemetry/api` is an optional peer dependency: without it, or with no SDK registered, the gate does no tracing. The claim is recorded only with `recordContent: true`.

No runtime dependency. ESM only, Node 22 or later.

Adapters: [`@mferret/done-gate-ai-sdk`](https://www.npmjs.com/package/@mferret/done-gate-ai-sdk) for the Vercel AI SDK, [`@mferret/done-gate-mastra`](https://www.npmjs.com/package/@mferret/done-gate-mastra) for Mastra.

Measured results, design decisions and limits: [github.com/MartinFerret/done-gate](https://github.com/MartinFerret/done-gate#readme).

MIT license.
