# @mferret/done-gate-mastra

[done-gate](https://github.com/MartinFerret/done-gate#readme) for Mastra: a `done` tool the agent cannot pass until your check against the real system does.

```sh
npm install @mferret/done-gate @mferret/done-gate-mastra @mastra/core zod
```

```ts
import { Agent } from '@mastra/core/agent';
import { createDoneGate } from '@mferret/done-gate';
import { doneTool, gateClosed } from '@mferret/done-gate-mastra';

const gate = createDoneGate({
  check: async () =>
    (await bookingExists('Alice', 'Tuesday 14:00'))
      ? { ok: true }
      : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
});

const agent = new Agent({
  id: 'booker',
  name: 'Booker',
  instructions: 'You complete tasks by calling tools. When the task is finished, call the "done" tool.',
  model: 'groq/openai/gpt-oss-20b',
  tools: { ...tools, done: doneTool(gate) },
});

// maxSteps defaults to 5 in Mastra, and a refused "done" costs a step.
const result = await agent.generate('Book the Tuesday 14:00 slot for Alice.', {
  maxSteps: 20,
  stopWhen: gateClosed(gate),
});

// A model that ends with a sentence instead of calling "done": check that closing answer once.
if (gate.outcome === 'pending' && result.text) await gate.decide(result.text);
if (gate.outcome !== 'done') throw new Error('The task was not completed');
```

- `doneTool(gate, { description? })`: the tool. A refused "done" goes back to the model with the reason, and the loop continues.
- `gateClosed(gate)`: a stop condition, true once the gate closed as `done` or `not_done`.

Tracing: Mastra has its own tracing system. The decision span joins the trace of the model calls only through `@mastra/otel-bridge`, which Mastra marks experimental. With `@mastra/otel-exporter` it lands in a separate trace.

Peer dependencies: `@mastra/core` 1.86 or later, `zod` 3.25 or 4, and `@mferret/done-gate`. ESM only, Node 22 or later.

Measured results, design decisions and limits: [github.com/MartinFerret/done-gate](https://github.com/MartinFerret/done-gate#readme).

MIT license.
