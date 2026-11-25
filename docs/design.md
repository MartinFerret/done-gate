# Design

Decisions and trade-offs, with the source for each. Versions and facts were checked on 2026-11-25
against the published packages and the official docs linked below.

## The problem

An agent loop usually ends when the model says it is finished. That statement is a claim, not a
fact. In [webmcp-harness](https://github.com/MartinFerret/webmcp-harness) the same agent, prompt and
task were run ten times per harness version: with no check, 4 runs out of 10 reported a booking that
did not exist; with an outcome check on "done", 0 out of 10 did (its `docs/results.md`, rows v0 and
v2, traces committed there).

done-gate is that outcome check, extracted: the agent may only finish through a gate, and the gate
asks the real system.

## Core API

```ts
const gate = createDoneGate({ check, maxRefusals: 3 });
const decision = await gate.decide('Booked Tuesday 14:00 for Alice');
// { accepted: true } | { accepted: false, reason, refusalsLeft }
gate.outcome; // 'pending' | 'done' | 'not_done'
```

| Choice | Why |
|---|---|
| `check` returns `{ ok: true }` or `{ ok: false, reason }` | A boolean would lose the one thing the agent needs to keep working: what is still wrong. The reason is sent back to the model word for word. |
| `check` is written by the user, per task | Only the application knows what "really done" means. The library cannot guess it, and a generic LLM judge would be a second claim, not a check. |
| A check that throws or times out is a refusal | The gate exists to stop unverified successes. If the check cannot answer, nothing was verified, so the claim is not accepted. The error message becomes the reason. |
| `timeoutMs` (default 10 000) with an `AbortSignal` passed to `check` | A check that hangs would hang the agent. The signal lets a well-written check cancel its own request. |
| `maxRefusals` (default 3) | Without a budget, an agent that cannot fix the problem repeats "done" until the step limit. With one, the run ends early and is reported as not done. The default matches webmcp-harness. |
| The refusal that uses up the budget closes the gate as `not_done` | The budget can only end a run as a failure. There is no path where running out of refusals turns into a success. |
| `gate.outcome` has three values | `pending` matters: a loop can stop for other reasons (step limit, the model answers in plain text and never calls "done"). Anything that is not `done` is not done. Callers and adapters read this one field. |
| A gate is one run | It holds the refusal count. Create one per agent run. After it closes, `decide` answers from the closed state and does not run the check again. |
| `decide` never throws | It is called from inside a tool. A thrown error there is handled differently by every framework. A returned refusal is handled the same way everywhere. |
| The claim is a short string | It is what the agent says it did. It is recorded in the trace next to the verdict, and passed to `check` for checks that want it. No schema, no generics, until a real case needs one. |

## How each framework lets a step refuse "done"

Both adapters use the same mechanism, because both frameworks support it natively: "done" is a tool.
The model calls it, the tool runs `gate.decide`, and the result goes back to the model like any tool
result. The loop stops through a stop condition that reads `gate.outcome`.

### Vercel AI SDK 7 (`ai@7.0.181`)

- Loop: `generateText({ tools, stopWhen })` or `ToolLoopAgent`. `stopWhen` takes one or more
  conditions `({ steps }) => boolean`, evaluated after the tools of a step have run.
  Docs: https://ai-sdk.dev/docs/agents/loop-control
- `hasToolCall('done')` is not enough: it stops when the tool is called, whatever the tool answered.
  That is exactly the unverified "done".
- A condition could inspect `steps.at(-1).toolResults[n].output`. The adapter reads `gate.outcome`
  instead: it does not depend on the shape of step results, which differs between frameworks.
- If the model answers in plain text and never calls the tool, the loop ends (`stoppedBy: 'model'`)
  and the gate was never asked. `gate.outcome` is still `pending`, so the run is not done. The
  adapter does not force `toolChoice: 'required'`: it changes how the model behaves on every step
  and is the caller's decision.
- If a tool throws, the SDK turns it into a tool error for the model and continues. `decide` never
  throws, so a failing check reaches the model as a normal refusal with a reason.

### When the agent stops without calling "done"

Seen in the first real runs with `openai/gpt-oss-20b`: after a refusal the agent fixed the booking,
then answered in plain text instead of calling "done" again. The loop ended with the gate `pending`
and a finished task was reported as not done.

The remedy needs no new API. A closing answer is a claim, so the caller gives it to the gate once:

```ts
if (gate.outcome === 'pending' && result.text) await gate.decide(result.text);
```

The examples and the bench do this. If that check fails, the run stays not done: the loop is over
and the agent cannot act on the reason.

### A provider quirk met on the way

With `openai/gpt-oss-20b` on Groq, when the model's reasoning is sent back in the history, its next
tool call can come out malformed (`done<|channel|>commentary`) and Groq rejects the request with a
400 (`tool_use_failed`). It was reproducible at temperature 0. The examples and the bench set
`providerOptions.groq.reasoningFormat` to `hidden`, with and without the gate, which keeps the
reasoning out of the history. This is not a done-gate concern, but anyone running the examples on
another setup should know.

### Mastra (`@mastra/core@1.86.0`)

- Loop: `agent.generate(messages, { stopWhen, maxSteps })`, tools made with `createTool`.
  Docs: https://mastra.ai/reference/agents/generate
- `stopWhen` has the same signature, but tool results in `steps` are wrapped differently
  (`output.value` there, `payload.result` in the final result). Reading `gate.outcome` avoids both.
- `maxSteps` defaults to 5. A refused "done" costs a step, so callers should set it explicitly.
- `onIterationComplete` could also veto the end of a run, but it does not put the refusal in front
  of the model as a tool result. Not used.

## Tracing

One span per decision, created with `@opentelemetry/api` only. With no SDK registered, the API
returns no-op spans and the gate does no tracing work. `@opentelemetry/api` is an optional peer
dependency, loaded on the first decision: if it is not installed, the gate skips tracing. The span
is active while the check runs, so what the check itself traces (an HTTP call, a query) is its child.

### What the GenAI conventions cover

Source: [semantic-conventions-genai](https://github.com/open-telemetry/semantic-conventions-genai)
at tag `v0.1.0` (commit `d0e74ba6c48bcc4ded473b1828a8212f06b23753`), `model/gen-ai/spans.yaml`. The
whole registry is at stability "development".

| Span | Name | Who emits it here |
|---|---|---|
| Agent invocation | `invoke_agent {gen_ai.agent.name}` | the framework |
| Model call | `chat {gen_ai.request.model}` | the framework |
| Tool execution | `execute_tool {gen_ai.tool.name}` | the framework, for the "done" tool |

done-gate does not emit these. Both frameworks already do (AI SDK through `@ai-sdk/otel`, Mastra
through `@mastra/otel-bridge`), and a second copy would be wrong.

### What has no convention yet

There is no span, operation or attribute for a verification, guardrail, outcome check or task
completion decision. The closest item is the `gen_ai.evaluation.result` event ("the result of
evaluating GenAI output for quality, accuracy, or other characteristics"). It is not used: it is a
log event about the quality of a model response, with a score, and the gate is a yes or no about
the state of an external system. Bending it would mislead anyone reading the data.

So the gate uses its own namespace, declared in a small registry extension (`conformance/`):

| Item | Value |
|---|---|
| Span name | `done_gate.decide {done_gate.name}` |
| Span kind | internal |
| `done_gate.name` | name of the gate (low cardinality) |
| `done_gate.accepted` | boolean, the verdict |
| `done_gate.reason` | why it was refused (absent when accepted) |
| `done_gate.refusal.count` | refusals so far in this run, this one included |
| `done_gate.refusals_left` | remaining budget |
| `done_gate.outcome` | `pending`, `done` or `not_done` after this decision |
| `done_gate.claim.summary` | what the agent claimed (content, opt-in) |
| `error.type` | set when the check could not answer: `timeout`, `invalid_result` or the name of the thrown error; this one is a stable core attribute |

The span status stays unset on a refusal: a refusal is the gate working. It is set to error only
when the check itself failed (threw or timed out).

Nothing is put under `gen_ai.`: that namespace belongs to the conventions.

### In the same trace as the model calls

- AI SDK: `@ai-sdk/otel` runs a tool's `execute` inside the context of its `execute_tool` span, so
  the gate span is a child of `execute_tool done` with no extra code. It needs a registered context
  manager.
- Mastra: its tracing is its own system. Only `@mastra/otel-bridge` (marked experimental) creates
  real OpenTelemetry spans and activates their context around tools. With `@mastra/otel-exporter`
  the gate span lands in a separate trace.

### Content

`done_gate.claim.summary` is model output. It is **not recorded by default**: `recordContent: true`
turns it on. This follows the GenAI conventions, where content attributes (messages, tool arguments
and results) are opt-in.

The frameworks do the opposite: `recordInputs` and `recordOutputs` default to true in AI SDK 7, and
Mastra records prompts and tool results by default. So in a trace made with their defaults the
claim is already visible, as the arguments of the `execute_tool done` span.

`done_gate.reason` is always recorded. It is written by the application's own check, not by the
model, and a refusal with no reason is of no use in a trace. A check should not put secrets in it.

## What is not supported, and why

- **Streaming APIs** (`streamText`, `agent.stream`): the gate works the same inside a tool, but only
  the non-streaming loops are tested and measured here.
- **Forcing the model to call "done"**: see above. If it never calls the tool, the run is not done.
- **Built-in checks or LLM judges**: a check must read the real system. That code belongs to the
  application.
- **Mastra workflows, agent networks, older Mastra `generateLegacy`**: one agent, one loop.
- **AI SDK 5 and 6**: tool and telemetry APIs differ (`experimental_telemetry`, no `@ai-sdk/otel`
  default integration). One supported major keeps the adapter thin.
- **CommonJS builds**: ESM only. `ai` 7 and `@mastra/core` 1.86 both require Node 22 or later, where
  `require()` of an ES module works.
- **Metrics and logs**: one span per decision carries everything measured here.
- **Parallel "done" calls in one step**: decisions on one gate run one at a time, in call order.

## Tooling

Exact versions are pinned in the root `package.json`. Each choice was tried in a throwaway package
before being adopted.

| Tool | Why this one |
|---|---|
| pnpm workspace | One lockfile, packages linked locally, examples excluded from publishing by `private: true`. |
| TypeScript 7.0.2, strict | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, `erasableSyntaxOnly`. `module: nodenext` rather than `bundler`: it enforces what a Node consumer actually resolves. |
| `isolatedDeclarations` | Every export carries an explicit type, so declarations are generated per file without the type checker. It also keeps the public API deliberate: nothing is exported with an inferred type. |
| tsdown 0.23.7 | The tsup README says it is no longer actively maintained and points to tsdown. tsdown runs publint and "are the types wrong" at the end of every build, so a broken `exports` map fails the build. |
| ESM only | See "What is not supported". Checked with `attw --profile esm-only`. |
| Vitest 5 | Workspace projects in one run, TypeScript without a build step. |
| oxlint with type-aware rules | `no-floating-promises` and `no-misused-promises` matter in a library whose core is one async decision. oxlint runs them on the same Go type checker as TypeScript 7. typescript-eslint 8 does not accept TypeScript 7 yet, and Biome's equivalents are still in its nursery group. |
| Biome, formatter only | Formatting is not worth a debate. Markdown is excluded: tables are written by hand. |
| changesets | Versions and changelogs per package. Configured, never run: nothing is published. |
| CI on Node 22, 24 and 26 | The three LTS lines alive on 2026-11-25 (26 active, 24 and 22 in maintenance). `ai` 7 and `@mastra/core` 1.86 need 22 or later, so nothing older is claimed. |
| pnpm 10.34.6 | The version this repo was built with, pinned in `packageManager`. |
