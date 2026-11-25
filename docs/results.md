# Results

Generated from `bench/traces/` by `pnpm --filter done-gate-bench report`. Do not edit.

One task ("Book the Tuesday 14:00 slot for Alice."), one model, one deterministic fault: the
first booking is lost and the tool answers that it worked. Each row is one batch of runs.

- **Reported done**: the run ended as a success. Without a gate, the agent called "done" or
  stopped with a text answer. With done-gate, the gate accepted a claim: a "done" call, or the
  closing text answer, which is checked once when the agent stops without calling "done".
- **Really done**: the booking exists in the system at the end of the run.
- **False success**: reported done, and not really done.
- **Refusals**: "done" claims the gate refused, over the whole batch.

| Adapter | Variant | Runs | Reported done | Really done | False successes | Refusals | Median steps | Median tokens |
|---|---|---|---|---|---|---|---|---|
| AI SDK | no gate | 10 | 10 | 0 | 10 | 0 | 2 | 555 |
| AI SDK | with done-gate | 10 | 10 | 10 | 0 | 10 | 6 | 3053 |
| Mastra | no gate | 10 | 10 | 0 | 10 | 0 | 2 | 579 |
| Mastra | with done-gate | 10 | 9 | 9 | 0 | 11 | 6 | 2963 |

Model: openai/gpt-oss-20b.

Same prompt and task in every run: prompt `042a2582cffc1b9687c62e7969af25283923bd83ffa387817d75be7731d016ca`, task `2960b56da66ee504a11f153f4a020223fc0bb2504c0328e312b7d63dce5bf9da`.

## Run ids

### AI SDK, no gate (`bench/traces/ai-sdk-no-gate`)

- Reported done: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Really done: none
- False successes: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Total tokens: 5550

### AI SDK, with done-gate (`bench/traces/ai-sdk-gate`)

- Reported done: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Really done: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- False successes: none
- Runs with at least one refused "done": 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Ended with a text answer that the gate then checked: 01, 02, 03, 04, 05, 06, 09, 10
- Ended as not done (refusal budget used up): none
- Ended with the gate still pending (step limit, or the agent stopped without calling "done"): none
- Total tokens: 30675

### Mastra, no gate (`bench/traces/mastra-no-gate`)

- Reported done: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Really done: none
- False successes: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Total tokens: 5790

### Mastra, with done-gate (`bench/traces/mastra-gate`)

- Reported done: 01, 02, 03, 04, 05, 06, 07, 08, 09
- Really done: 01, 02, 03, 04, 05, 06, 07, 08, 09
- False successes: none
- Runs with at least one refused "done": 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Ended with a text answer that the gate then checked: 01, 02, 03, 04, 05, 06, 07, 08, 09, 10
- Ended as not done (refusal budget used up): none
- Ended with the gate still pending (step limit, or the agent stopped without calling "done"): 10
- Total tokens: 30000
