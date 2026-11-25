// Usage: pnpm bench <adapter> <variant> <runs> [--out <dir>]
//   pnpm bench ai-sdk no-gate 10                                  traces in a fresh folder under runs/
//   pnpm bench ai-sdk gate 10 --out traces/ai-sdk-gate            a measured batch, resumable
// Adapters: ai-sdk, mastra. Variants: gate, no-gate. Build the table with: pnpm report
import { groq } from '@ai-sdk/groq';
import { aiSdkAgent, mastraAgent } from './agents.ts';
import { runBatch, type Variant } from './run.ts';

const MODEL = 'openai/gpt-oss-20b';
const agents = {
  'ai-sdk': () => aiSdkAgent(groq(MODEL)),
  mastra: () => mastraAgent(`groq/${MODEL}`),
};

const isAdapter = (name: string | undefined): name is keyof typeof agents =>
  name !== undefined && name in agents;

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const out = outAt === -1 ? undefined : args.splice(outAt, 2)[1];
const [adapter, variant, runs = '1'] = args;
if (!isAdapter(adapter) || (variant !== 'gate' && variant !== 'no-gate')) {
  throw new Error('Usage: pnpm bench <ai-sdk|mastra> <gate|no-gate> <runs> [--out <dir>]');
}
if (!process.env['GROQ_API_KEY']) throw new Error('GROQ_API_KEY is not set (see .env.example)');

const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
const dir = out ?? `../runs/${stamp}-${adapter}-${variant}`;
console.log(`Traces: ${dir}`);
await runBatch({
  adapter,
  variant: variant satisfies Variant,
  model: MODEL,
  agent: agents[adapter](),
  runs: Number(runs),
  dir,
  onResult: (run, r) => {
    console.log(
      `${adapter} ${variant} run ${run}: saidDone=${r.saidDone} reallyDone=${r.reallyDone} refusals=${r.refusals} steps=${r.steps} tokens=${r.tokens}`,
    );
  },
});
