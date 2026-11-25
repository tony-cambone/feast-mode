import type { Plan } from '../../data/types';
import { CookAlongUI } from '../CookAlongUI';
import type { DisplayPrefs } from '../display';
import { PlanHost } from '../PlanHost';
import type { PlansControl } from '../shared';
import { SCENARIOS, useMockApi, useMockPlanSource } from './mockApi';
import type { Scenario } from './mockApi';

function MockCook({ plan, plans, scenario, start }: { plan: Plan; plans: PlansControl; scenario: Scenario; start: boolean }) {
  const api = useMockApi(plan, scenario, start);
  return <CookAlongUI api={api} plans={plans} />;
}

/** `?mock=<scenario>`: see mockApi.ts for the options. */
export function MockApp() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('mock') as Scenario | null;
  const scenario: Scenario = raw && SCENARIOS.includes(raw) ? raw : 'dash';
  const ps = useMockPlanSource();
  const override: Partial<DisplayPrefs> = {};
  const theme = q.get('theme');
  const text = q.get('text');
  if (theme === 'dark' || theme === 'light' || theme === 'auto') override.theme = theme;
  if (text === 's' || text === 'm' || text === 'l' || text === 'xl') override.textSize = text;
  return (
    <PlanHost ps={ps} displayOverride={override}>
      {(plans, rev) => <MockCook key={`${ps.plan.id}#${rev}`} plan={ps.plan} plans={plans} scenario={scenario} start={q.has('start')} />}
    </PlanHost>
  );
}
