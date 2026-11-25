import { useCookAlong } from './app/useCookAlong';
import { usePlanSource } from './app/usePlanSource';
import type { Plan } from './data/types';
import { CookAlongUI } from './ui/CookAlongUI';
import { PlanHost } from './ui/PlanHost';
import type { PlansControl } from './ui/shared';

/** One cook-along per plan. Keyed by the caller, so switching plans remounts it cleanly. */
function CookAlong({ plan, plans }: { plan: Plan; plans: PlansControl }) {
  const api = useCookAlong(plan);
  return <CookAlongUI api={api} plans={plans} />;
}

export default function App() {
  const ps = usePlanSource();
  return <PlanHost ps={ps}>{(plans, rev) => <CookAlong key={`${ps.plan.id}#${rev}`} plan={ps.plan} plans={plans} />}</PlanHost>;
}
