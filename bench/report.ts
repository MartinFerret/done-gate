// Rebuilds docs/results.md from bench/traces only. Every number in it is counted from a trace.
// Usage: pnpm report
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RunResult } from './run.ts';

interface Start {
  readonly model: string;
  readonly promptSha256: string;
  readonly taskSha256: string;
}
type Line =
  | ({ readonly type: 'start' } & Start)
  | { readonly type: 'step' }
  | ({ readonly type: 'result' } & RunResult);
interface Run {
  readonly id: string;
  readonly start: Start;
  readonly result: RunResult;
}

const HERE = import.meta.dirname;
const BATCHES = [
  { adapter: 'ai-sdk', label: 'AI SDK', variant: 'no-gate' },
  { adapter: 'ai-sdk', label: 'AI SDK', variant: 'gate' },
  { adapter: 'mastra', label: 'Mastra', variant: 'no-gate' },
  { adapter: 'mastra', label: 'Mastra', variant: 'gate' },
];

/** The complete runs of one batch, in order. */
export function readBatch(dir: string): Run[] {
  if (!existsSync(dir)) return [];
  const runs: Run[] = [];
  for (const file of readdirSync(dir).toSorted()) {
    if (!file.endsWith('.jsonl')) continue;
    const lines: Line[] = readFileSync(join(dir, file), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const start = lines.find((line) => line.type === 'start');
    const result = lines.find((line) => line.type === 'result');
    if (start && result) runs.push({ id: file.slice(4, 6), start, result });
  }
  return runs;
}

function median(values: number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const ids = (runs: Run[]): string => (runs.length ? runs.map((r) => r.id).join(', ') : 'none');

export function buildReport(tracesDir: string): string {
  const rows: string[] = [];
  const notes: string[] = [];
  const hashes = new Set<string>();
  const models = new Set<string>();

  for (const batch of BATCHES) {
    const name = `${batch.adapter}-${batch.variant}`;
    const runs = readBatch(join(tracesDir, name));
    const variant = batch.variant === 'gate' ? 'with done-gate' : 'no gate';
    if (runs.length === 0) {
      rows.push(`| ${batch.label} | ${variant} | not measured yet | | | | | | |`);
      continue;
    }
    for (const run of runs) {
      hashes.add(`prompt \`${run.start.promptSha256}\`, task \`${run.start.taskSha256}\``);
      models.add(run.start.model);
    }
    const said = runs.filter((r) => r.result.saidDone);
    const really = runs.filter((r) => r.result.reallyDone);
    const falseSuccesses = runs.filter((r) => r.result.saidDone && !r.result.reallyDone);
    const refused = runs.filter((r) => r.result.refusals > 0);
    rows.push(
      `| ${batch.label} | ${variant} | ${runs.length} | ${said.length} | ${really.length} | ${falseSuccesses.length} | ${runs.reduce((n, r) => n + r.result.refusals, 0)} | ${median(runs.map((r) => r.result.steps))} | ${median(runs.map((r) => r.result.tokens))} |`,
    );
    notes.push(
      `### ${batch.label}, ${variant} (\`bench/traces/${name}\`)`,
      '',
      `- Reported done: ${ids(said)}`,
      `- Really done: ${ids(really)}`,
      `- False successes: ${ids(falseSuccesses)}`,
      ...(batch.variant === 'gate'
        ? [
            `- Runs with at least one refused "done": ${ids(refused)}`,
            `- Ended as not done (refusal budget used up): ${ids(runs.filter((r) => r.result.gateOutcome === 'not_done'))}`,
            `- Ended with the gate still pending (step limit, or the agent stopped without calling "done"): ${ids(runs.filter((r) => r.result.gateOutcome === 'pending'))}`,
          ]
        : []),
      `- Total tokens: ${runs.reduce((n, r) => n + r.result.tokens, 0)}`,
      '',
    );
  }

  return [
    '# Results',
    '',
    'Generated from `bench/traces/` by `pnpm --filter done-gate-bench report`. Do not edit.',
    '',
    'One task ("Book the Tuesday 14:00 slot for Alice."), one model, one deterministic fault: the',
    'first booking is lost and the tool answers that it worked. Each row is one batch of runs.',
    '',
    '- **Reported done**: the run ended as a success. Without a gate, the agent called "done".',
    '  With done-gate, the gate accepted a "done".',
    '- **Really done**: the booking exists in the system at the end of the run.',
    '- **False success**: reported done, and not really done.',
    '- **Refusals**: "done" claims the gate refused, over the whole batch.',
    '',
    '| Adapter | Variant | Runs | Reported done | Really done | False successes | Refusals | Median steps | Median tokens |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows,
    '',
    ...(models.size ? [`Model: ${[...models].join(', ')}.`, ''] : []),
    ...(hashes.size === 1 ? [`Same prompt and task in every run: ${[...hashes][0]}.`, ''] : []),
    ...(hashes.size > 1
      ? [
          '**Warning: the prompt or the task differs between runs:**',
          '',
          ...[...hashes].map((h) => `- ${h}`),
          '',
        ]
      : []),
    ...(notes.length ? ['## Run ids', '', ...notes] : []),
  ].join('\n');
}

if (import.meta.main) {
  const report = buildReport(join(HERE, 'traces'));
  writeFileSync(join(HERE, '../docs/results.md'), report);
  console.log(report);
}
