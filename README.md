# done-gate

An AI agent says "done". done-gate asks the real system whether that is true before the run is allowed to end. If it is not, the agent gets the reason back and keeps working.

**Status:** library, adapters, tests and conformance are in place. The measured runs (the failure trace, the results table, the trace screenshot) are not done yet: every place that needs one says "not measured yet".

---

## The failure

An agent loop ends when the model says it is finished. That is a claim, not a fact.

In [webmcp-harness](https://github.com/MartinFerret/webmcp-harness), the same agent, prompt and task were run ten times per harness version. With no check on "done", 4 runs out of 10 reported a booking that did not exist. With an outcome check, 0 out of 10 did. The traces are committed there (`docs/results.md`, rows v0 and v2).

done-gate is that outcome check as a library. Its own failure trace, from this repo's experiment: not measured yet.

The experiment reproduces the same kind of fault: the first booking is lost, and the tool answers that it worked. The tests replay it with a scripted model, no network: without a gate the run stops after "done" with nothing booked; with the gate the same "done" is refused, the agent books again, and the run ends with the booking in place (`packages/ai-sdk/src/adapter.test.ts`, `packages/mastra/src/adapter.test.ts`).

---

## Usage

```ts
import { generateText, isStepCount } from 'ai';
import { createDoneGate } from 'done-gate';
import { doneTool, gateClosed } from '@done-gate/ai-sdk';

const gate = createDoneGate({
  // Read the real system. Not the model's answer, not a tool's return value.
  check: async () =>
    (await bookingExists('Alice', 'Tuesday 14:00'))
      ? { ok: true }
      : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
});

await generateText({
  model,
  prompt: 'Book the Tuesday 14:00 slot for Alice.',
  tools: { ...tools, done: doneTool(gate) },
  stopWhen: [gateClosed(gate), isStepCount(20)],
});

if (gate.outcome !== 'done') throw new Error('The task was not completed');
```

With Mastra, the same two functions come from `@done-gate/mastra`:

```ts
const agent = new Agent({ id, name, instructions, model, tools: { ...tools, done: doneTool(gate) } });
await agent.generate(task, { maxSteps: 20, stopWhen: gateClosed(gate) });
```

Without a framework, call the gate yourself wherever your loop handles "done":

```ts
const decision = await gate.decide(claim);
// { accepted: true } or { accepted: false, reason, refusalsLeft }
```

| Package | What it is |
|---|---|
| `done-gate` | The gate. No runtime dependency. `@opentelemetry/api` is an optional peer. |
| `@done-gate/ai-sdk` | `doneTool` and `gateClosed` for the Vercel AI SDK 7. |
| `@done-gate/mastra` | `doneTool` and `gateClosed` for Mastra 1.x. |

Nothing is published to npm. To try it, clone the repo (see [Run it](#run-it)).

---

## How it works

1. The agent gets a `done` tool. Calling it is the only way to finish.
2. The tool calls `gate.decide(claim)`, which runs your `check` against the real system.
3. The check passes: the decision is `{ accepted: true }`, the gate closes as `done`, and the stop condition ends the loop.
4. The check fails: the decision is `{ accepted: false, reason, refusalsLeft }`. It goes back to the model as the tool result, and the loop continues.
5. After `maxRefusals` refusals (default 3), the gate closes as `not_done` and the loop ends. Running out of refusals is never a success.
6. A check that throws, times out (default 10 s) or returns something invalid is a refusal, with the error as the reason. It is never a pass.

After the run, read `gate.outcome`. Only `done` is a success. `pending` means the loop stopped for another reason: a step limit, or a model that answered in plain text and never called the tool.

---

## Results

Generated from the traces in `bench/traces/` into [docs/results.md](docs/results.md).

A **false success** is a run that was reported as done while the task was not done in the system.

| Adapter | Variant | Runs | Reported done | Really done | False successes |
|---|---|---|---|---|---|
| AI SDK | no gate | not measured yet | | | |
| AI SDK | with done-gate | not measured yet | | | |
| Mastra | no gate | not measured yet | | | |
| Mastra | with done-gate | not measured yet | | | |

The experiment: one task, one model (`openai/gpt-oss-20b` on Groq), ten runs per row, the same prompt and task hashed in every trace, and one deterministic fault (the first booking is lost and reported as booked).

---

## Tracing

Every decision is one OpenTelemetry span, `done_gate.decide {name}`, with the verdict, the reason, the refusal count and the claim. It is created with `@opentelemetry/api` only: with no SDK registered it costs nothing.

With `@ai-sdk/otel` (AI SDK) or `@mastra/otel-bridge` (Mastra), the span is a child of the framework's `execute_tool done` span, so the model calls, the refused "done" with its reason and the accepted one are in a single trace. Both are covered by tests.

Screenshot of a real run in the local viewer: not measured yet. To see it yourself: [examples/tracing](examples/tracing).

**Content.** The AI SDK and Mastra record prompts, tool arguments and tool results in spans by default. The gate records the claim by default too; `recordContent: false` turns that off.

**Conformance.** The spans done-gate emits are validated in CI with [OpenTelemetry Weaver](https://github.com/open-telemetry/weaver) `v0.28.0` live-check, against a registry built on [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai) `v0.1.0`: 0 violations. The GenAI conventions have no span for a verification or a "done" decision, so the gate's span and its `done_gate.*` attributes are declared in a small registry extension. What that check proves, what it does not, and every finding Weaver reports: [conformance/](conformance/README.md).

---

## Run it

Node 22 or later, pnpm 10, Docker for the conformance check and the trace viewer.

```sh
pnpm install
pnpm check                                   # build, types, lint, format, tests (no network, no tokens)
pnpm conformance                             # Weaver live-check, needs Docker

cp .env.example .env                         # then add a free Groq key
pnpm --filter example-ai-sdk-basic start     # the same task without and with the gate
pnpm --filter example-mastra-basic start
pnpm --filter done-gate-bench bench ai-sdk gate 10
```

---

## Limits

- **Sample size.** Ten runs per row, once measured. Enough to see a failure mode, not to estimate a rate.
- **One model, one task.** `openai/gpt-oss-20b`, one booking task, one injected fault.
- **The check is yours to write, per task.** The gate is only as good as the check. A check that reads what the agent said, instead of the system, verifies nothing.
- **What the gate cannot catch.** Anything the check does not look at: a booking made for the right person and also a wrong one, side effects, quality. And it only acts when the agent claims "done": a run that ends another way is `pending`, which callers must treat as not done.
- **It does not make the agent better.** It stops false successes. A refused agent that cannot fix the problem ends as `not_done`.
- **Conventions in development.** The whole GenAI registry is at stability "development", and so are the `done_gate.*` attributes. Names can change.
- **Not supported.** Streaming loops, CommonJS, AI SDK 5 and 6: see the design notes.

---

## Design decisions

Every choice, with its reason and its source: [docs/design.md](docs/design.md).

MIT license.
