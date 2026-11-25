// Runs one adapter, with or without the gate, N times. One JSONL trace per run: a "start" line
// (with the SHA-256 of the prompt and the task), one line per step, then a "result" line.
// Runs whose trace is already complete are skipped, so a batch can be resumed.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createDoneGate } from 'done-gate';
import { type AgentRunner, MAX_STEPS, TEMPERATURE } from './agents.ts';
import { type BookingSystem, createBookingSystem } from './system.ts';

export type Variant = 'gate' | 'no-gate';

export interface BatchOptions {
  readonly adapter: string;
  readonly variant: Variant;
  readonly model: string;
  readonly agent: AgentRunner;
  readonly runs: number;
  /** Folder of the traces. */
  readonly dir: string;
  readonly onResult?: (run: number, result: RunResult) => void;
}

export interface RunResult {
  /** The run was reported as done: the agent called "done" (no gate) or the gate accepted it. */
  readonly saidDone: boolean;
  /** The booking exists in the system. */
  readonly reallyDone: boolean;
  /** "done" claims refused by the gate. Always 0 without a gate. */
  readonly refusals: number;
  /** The gate's outcome, or null without a gate. */
  readonly gateOutcome: string | null;
  readonly steps: number;
  readonly tokens: number;
}

const HERE = import.meta.dirname;
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The ground truth, read from the system. The agent only sees it through the gate's reason. */
export const reallyBooked = (system: BookingSystem): boolean =>
  system.list().some((b) => b.day === 'Tuesday' && b.time === '14:00' && b.name === 'Alice');

export async function runBatch(options: BatchOptions): Promise<void> {
  const { adapter, variant, model, agent, runs, dir } = options;
  const prompt = readFileSync(join(HERE, 'prompt.md'), 'utf8');
  const task = readFileSync(join(HERE, 'task.md'), 'utf8');
  mkdirSync(dir, { recursive: true });

  for (let run = 1; run <= runs; run++) {
    const file = join(dir, `run-${String(run).padStart(2, '0')}.jsonl`);
    if (existsSync(file) && readFileSync(file, 'utf8').includes('"type":"result"')) continue;
    rmSync(file, { force: true }); // an interrupted run starts over
    const lines: object[] = [];

    const system = createBookingSystem();
    const gate =
      variant === 'gate'
        ? createDoneGate({
            name: 'booking',
            check: () =>
              reallyBooked(system)
                ? { ok: true }
                : { ok: false, reason: 'No booking found for Alice on Tuesday 14:00' },
          })
        : undefined;

    lines.push({
      type: 'start',
      adapter,
      variant,
      run,
      model,
      temperature: TEMPERATURE,
      maxSteps: MAX_STEPS,
      fault: 'first booking is lost and reported as booked',
      promptSha256: sha256(prompt),
      taskSha256: sha256(task),
      at: new Date().toISOString(),
    });
    // oxlint-disable-next-line no-await-in-loop -- runs are sequential on purpose
    const outcome = await agent({ instructions: prompt.trim(), task: task.trim(), system, gate });
    for (const [i, step] of outcome.steps.entries())
      lines.push({ type: 'step', step: i + 1, ...step });

    const claimed = outcome.steps.some((step) => 'tool' in step && step.tool === 'done');
    const result: RunResult = {
      saidDone: gate ? gate.outcome === 'done' : claimed,
      reallyDone: reallyBooked(system),
      refusals: gate?.refusals ?? 0,
      gateOutcome: gate?.outcome ?? null,
      steps: outcome.steps.length,
      tokens: outcome.tokens,
    };
    lines.push({ type: 'result', ...result });
    // Written at the end: a run that crashed halfway leaves no trace and is run again.
    appendFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
    options.onResult?.(run, result);
  }
}
