/**
 * Bundled plans. Each plans/*.json is validated at load; an invalid plan throws with every error,
 * so a typo never reaches the cook on the day. To add a plan: drop a JSON file in plans/, import it
 * here, and add it to RAW.
 */
import type { Plan } from './types';
import { validatePlan } from './validate';
// `with { type: 'json' }` lets plain Node (Playwright, scripts) import these as well as Vite.
import thanksgiving from '../../plans/thanksgiving-2026.json' with { type: 'json' };
import christmas from '../../plans/christmas-dinner.json' with { type: 'json' };

const RAW: Array<{ file: string; json: unknown }> = [
  { file: 'plans/thanksgiving-2026.json', json: thanksgiving },
  { file: 'plans/christmas-dinner.json', json: christmas },
];

function load(file: string, json: unknown): Plan {
  const r = validatePlan(json);
  if (!r.ok) {
    throw new Error(`Invalid plan ${file}:\n  - ${r.errors.join('\n  - ')}`);
  }
  return r.plan;
}

export const bundledPlans: Plan[] = RAW.map((r) => load(r.file, r.json));

/** The default plan (Thanksgiving). */
export const plan: Plan = bundledPlans.find((p) => p.id === 'thanksgiving-2026') ?? bundledPlans[0];

export default plan;
