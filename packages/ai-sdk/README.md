# @mferret/done-gate-ai-sdk

[done-gate](https://github.com/MartinFerret/done-gate#readme) for the Vercel AI SDK 7: a `done` tool the agent cannot pass until your check against the real system does.

```sh
npm install @mferret/done-gate @mferret/done-gate-ai-sdk ai
```

```ts
import { generateText, isStepCount } from 'ai';
import { createDoneGate } from '@mferret/done-gate';
import { doneTool, gateClosed } from '@mferret/done-gate-ai-sdk';

const gate = createDoneGate({
  check: async () =>
    (await bookingExists('Alice', 'Tuesday 14:00'))
      ? { ok: true }
      : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
});

const result = await generateText({
  model,
  prompt: 'Book the Tuesday 14:00 slot for Alice.',
  tools: { ...tools, done: doneTool(gate) },
  stopWhen: [gateClosed(gate), isStepCount(20)],
});

// A model that ends with a sentence instead of calling "done": check that closing answer once.
if (gate.outcome === 'pending' && result.text) await gate.decide(result.text);
if (gate.outcome !== 'done') throw new Error('The task was not completed');
```

- `doneTool(gate, { description? })`: the tool. A refused "done" goes back to the model with the reason, and the loop continues.
- `gateClosed(gate)`: a stop condition, true once the gate closed as `done` or `not_done`.

With `@ai-sdk/otel` registered, each decision span is a child of the SDK's `execute_tool done` span, in the trace of the model calls. Note that the AI SDK records prompts and tool results in spans by default.

Peer dependencies: `ai` 7 and `@mferret/done-gate`. ESM only, Node 22 or later.

Measured results, design decisions and limits: [github.com/MartinFerret/done-gate](https://github.com/MartinFerret/done-gate#readme).

MIT license.
