// Takes the README screenshot: the latest trace in Phoenix that contains a refused "done",
// opened on that gate decision. Usage: pnpm screenshot   (after `pnpm viewer` and `pnpm demo`)
// Phoenix REST API: https://arize.com/docs/phoenix/sdk-api-reference/rest-api
// https://playwright.dev/docs/screenshots
import { chromium } from 'playwright';

const PHOENIX = 'http://localhost:6006';
const OUT = '../../docs/trace.png';

interface Span {
  readonly name: string;
  readonly start_time: string;
  readonly context: { readonly trace_id: string };
  readonly attributes: Record<string, unknown>;
}

const getJson = async (path: string): Promise<string> => (await fetch(`${PHOENIX}${path}`)).text();

const projects: { data: { id: string; name: string }[] } = JSON.parse(
  await getJson('/v1/projects'),
);
const project = projects.data.find((p) => p.name === 'default');
if (!project) throw new Error('Phoenix has no "default" project. Is it running? (pnpm viewer)');

const spans: { data: Span[] } = JSON.parse(
  await getJson(`/v1/projects/${project.id}/spans?limit=1000`),
);
const refused = spans.data
  .filter(
    (s) => s.name.startsWith('done_gate.decide') && s.attributes['done_gate.accepted'] === false,
  )
  .toSorted((a, b) => b.start_time.localeCompare(a.start_time))[0];
if (!refused) throw new Error('No trace with a refused "done" found. Run `pnpm demo` first.');

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1440, height: 1250 },
  deviceScaleFactor: 2,
});
await page.goto(`${PHOENIX}/projects/${project.id}/traces/${refused.context.trace_id}`);
// Open the refused decision, so its attributes (accepted, reason, refusal count) are visible.
await page.getByText(refused.name).first().click();
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT });
await browser.close();
console.log(`Trace ${refused.context.trace_id} -> ${OUT}`);
