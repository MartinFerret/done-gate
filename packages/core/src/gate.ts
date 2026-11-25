/** What a check answers: the task is really done, or why it is not. */
export type CheckResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** What a check receives for one claim. */
export interface CheckContext {
  /** What the agent said it did. */
  readonly claim: string;
  /** 1 for the first claim of the run, 2 for the second, and so on. */
  readonly attempt: number;
  /** Aborted when the check times out. Pass it to `fetch` and friends. */
  readonly signal: AbortSignal;
}

/** Reads the real system and says whether the task is done. */
export type Check = (context: CheckContext) => CheckResult | Promise<CheckResult>;

export interface DoneGateOptions {
  /** Reads the real system. Throwing or timing out counts as "not done". */
  readonly check: Check;
  /** Refusals after which the run ends as not done. Default 3. */
  readonly maxRefusals?: number;
  /** Time given to one check, in milliseconds. Default 10 000. */
  readonly timeoutMs?: number;
  /** Name of the gate in traces. Default "done". */
  readonly name?: string;
}

/** The answer to one "done" claim. */
export type Decision =
  | { readonly accepted: true }
  | { readonly accepted: false; readonly reason: string; readonly refusalsLeft: number };

/**
 * Where the run stands. Only `done` is a success: `pending` means no claim was accepted yet,
 * `not_done` means the refusal budget ran out.
 */
export type Outcome = 'pending' | 'done' | 'not_done';

/** The gate of one agent run. Create one per run. */
export interface DoneGate {
  readonly name: string;
  readonly outcome: Outcome;
  /** Claims refused so far. */
  readonly refusals: number;
  /** Checks a "done" claim. Never throws. */
  decide(claim: string): Promise<Decision>;
}

const DEFAULT_MAX_REFUSALS = 3;
const DEFAULT_TIMEOUT_MS = 10_000;

export function createDoneGate(options: DoneGateOptions): DoneGate {
  const {
    check,
    maxRefusals = DEFAULT_MAX_REFUSALS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    name = 'done',
  } = options;
  if (!Number.isInteger(maxRefusals) || maxRefusals < 1) {
    throw new TypeError(`maxRefusals must be a positive integer, got ${maxRefusals}`);
  }
  if (!(timeoutMs > 0)) {
    throw new TypeError(`timeoutMs must be greater than 0, got ${timeoutMs}`);
  }

  let outcome: Outcome = 'pending';
  let refusals = 0;
  let attempts = 0;
  let lastReason = '';
  let queue: Promise<unknown> = Promise.resolve();

  async function decideNow(claim: string): Promise<Decision> {
    if (outcome === 'done') return { accepted: true };
    if (outcome === 'not_done') {
      return {
        accepted: false,
        reason: `The run already ended as not done: ${lastReason}`,
        refusalsLeft: 0,
      };
    }

    attempts += 1;
    const result = await runCheck(check, { claim, attempt: attempts }, timeoutMs);
    if (result.ok) {
      outcome = 'done';
      return { accepted: true };
    }

    refusals += 1;
    lastReason = result.reason;
    const refusalsLeft = maxRefusals - refusals;
    if (refusalsLeft === 0) outcome = 'not_done';
    return { accepted: false, reason: result.reason, refusalsLeft };
  }

  return {
    name,
    get outcome(): Outcome {
      return outcome;
    },
    get refusals(): number {
      return refusals;
    },
    decide(claim: string): Promise<Decision> {
      // One decision at a time: two claims in the same step must not share a refusal count.
      const decision = queue.then(() => decideNow(claim));
      queue = decision;
      return decision;
    },
  };
}

/** Runs the check. Whatever goes wrong comes back as a refusal, never as a pass or a throw. */
async function runCheck(
  check: Check,
  input: Omit<CheckContext, 'signal'>,
  timeoutMs: number,
): Promise<CheckResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<CheckResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: `The check timed out after ${timeoutMs} ms` });
    }, timeoutMs);
  });

  try {
    const answer = Promise.resolve().then(() => check({ ...input, signal: controller.signal }));
    return validate(await Promise.race([answer, timedOut]));
  } catch (error) {
    return { ok: false, reason: `The check failed: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
  }
}

function validate(result: unknown): CheckResult {
  if (typeof result === 'object' && result !== null && 'ok' in result) {
    if (result.ok === true) return { ok: true };
    if (result.ok === false && 'reason' in result && typeof result.reason === 'string') {
      return { ok: false, reason: result.reason };
    }
  }
  return { ok: false, reason: 'The check returned an invalid result' };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
