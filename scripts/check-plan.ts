/**
 * Validate plan files: `node scripts/check-plan.ts plans/my.json [more.json ...]`
 * (or `npm run check-plan -- plans/my.json`). Exit code 1 if any file has errors.
 */
import { readFileSync } from 'node:fs';
import { validatePlan } from '../src/data/validate.ts';

/** True when the text so far is a valid JSON prefix (it only fails because it is cut short). */
function isPrefixOk(text: string, n: number): boolean {
  try {
    JSON.parse(text.slice(0, n));
    return true;
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/end of JSON input|Unterminated string|Unexpected end/i.test(m)) return true;
    const pos = /at position (\d+)/.exec(m);
    return pos !== null && Number(pos[1]) >= n; // the complaint is about the cut-off itself
  }
}

/** Turn a JSON.parse error into "line L, column C" (finds the first bad character by bisection). */
function locate(text: string, err: unknown): string {
  const full = err instanceof Error ? err.message : String(err);
  const tok = /^Unexpected token '[^']*'/.exec(full);
  const msg = tok ? tok[0] : full.split('\n')[0];
  const lc = /\(line (\d+) column (\d+)\)/.exec(full);
  if (lc) return `line ${lc[1]}, column ${lc[2]}: ${msg}`;
  let lo = 0;
  let hi = text.length; // invariant: prefix(lo) ok, prefix(hi) bad
  if (isPrefixOk(text, hi)) return `unexpected end of file (${msg})`;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (isPrefixOk(text, mid)) lo = mid;
    else hi = mid;
  }
  const before = text.slice(0, hi).split('\n');
  return `line ${before.length}, column ${before[before.length - 1].length}: ${msg}`;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/check-plan.ts <plan.json> [more.json ...]');
  process.exit(2);
}

let failed = false;
for (const file of files) {
  if (file.endsWith('plan.schema.json')) continue; // the JSON Schema itself is not a plan
  console.log(`\n== ${file}`);
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (e) {
    console.log(`  ERROR cannot read file: ${e instanceof Error ? e.message : String(e)}`);
    failed = true;
    continue;
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    console.log(`  ERROR JSON syntax, ${locate(text, e)}`);
    failed = true;
    continue;
  }
  const r = validatePlan(json);
  if (!r.ok) {
    failed = true;
    for (const m of r.errors) console.log(`  ERROR ${m}`);
  }
  for (const m of r.warnings) console.log(`  warn  ${m}`);
  if (r.ok) {
    const p = r.plan;
    console.log(`  OK "${p.title}" (${p.id}) ${p.timeZone}, °${p.tempUnit ?? 'F'}`);
    for (const d of p.days) {
      console.log(`    day ${d.id} ${d.date}  ${d.label}: ${p.tasks.filter((t) => t.day === d.id).length} tasks`);
    }
    console.log(`    devices: ${p.devices.map((d) => d.id).join(', ') || '(none)'}`);
    console.log(`    recipes: ${p.recipes.length}, fallbacks: ${(p.fallbacks ?? []).length}, variants: ${(p.variants ?? []).length}`);
  }
  console.log(`  ${r.ok ? 0 : r.errors.length} error(s), ${r.warnings.length} warning(s)`);
}
process.exit(failed ? 1 : 0);
