import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanSourceApi } from '../app/api';
import { DisplayProvider } from './display';
import type { DisplayPrefs } from './display';
import { PlansDrawer } from './PlansDrawer';
import type { PlansControl } from './shared';
import { applyAccent, setFavicon } from './theme';

/**
 * Everything that outlives a plan switch: the display options, the plan's accent colour and
 * tab icon, and the Plans drawer. `children` renders the cook-along for the active plan;
 * key it with `${plan.id}#${rev}` so it remounts when the plan is switched or re-imported.
 */
export function PlanHost({
  ps,
  children,
  displayOverride,
}: {
  ps: PlanSourceApi;
  children: (plans: PlansControl, rev: number) => ReactNode;
  displayOverride?: Partial<DisplayPrefs>;
}) {
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState(0);
  const accent = ps.plan.theme?.accent;
  const emoji = ps.plan.emoji;

  useEffect(() => applyAccent(accent), [accent]);
  useEffect(() => setFavicon(emoji), [emoji]);

  const importPlan = useCallback<PlanSourceApi['importPlan']>(
    (text) => {
      const r = ps.importPlan(text);
      if (r.ok) setRev((n) => n + 1); // same id re-imported: still remount on the new content
      return r;
    },
    [ps],
  );

  const plans = useMemo<PlansControl>(() => ({ isOpen: open, open: () => setOpen(true), close: () => setOpen(false) }), [open]);

  return (
    <DisplayProvider override={displayOverride}>
      {children(plans, rev)}
      {open && <PlansDrawer ps={ps} importPlan={importPlan} z={260} onClose={plans.close} />}
    </DisplayProvider>
  );
}
