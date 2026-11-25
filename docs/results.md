# Results

Generated from `bench/traces/` by `pnpm --filter done-gate-bench report`. Do not edit.

One task ("Book the Tuesday 14:00 slot for Alice."), one model, one deterministic fault: the
first booking is lost and the tool answers that it worked. Each row is one batch of runs.

- **Reported done**: the run ended as a success. Without a gate, the agent called "done".
  With done-gate, the gate accepted a "done".
- **Really done**: the booking exists in the system at the end of the run.
- **False success**: reported done, and not really done.
- **Refusals**: "done" claims the gate refused, over the whole batch.

| Adapter | Variant | Runs | Reported done | Really done | False successes | Refusals | Median steps | Median tokens |
|---|---|---|---|---|---|---|---|---|
| AI SDK | no gate | not measured yet | | | | | | |
| AI SDK | with done-gate | not measured yet | | | | | | |
| Mastra | no gate | not measured yet | | | | | | |
| Mastra | with done-gate | not measured yet | | | | | | |
