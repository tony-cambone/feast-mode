import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CookAlongApi } from '../app/api';
import type { ShiftScope } from '../engine/types';
import { toggleFullscreen } from '../platform';
import { AlertModal } from './AlertModal';
import { Board } from './Board';
import { Drawer, ProblemsDrawer, RecipesDrawer, SettingsDrawer, TaskDrawer, TempsDrawer } from './Drawers';
import { Header } from './Header';
import type { View } from './Header';
import { ScheduleView } from './ScheduleView';
import { NowPanel } from './NowPanel';
import { Banners, ConfirmDialog, PrintSheet, StartOverlay, TestBanner, Toasts } from './Overlays';
import { ShiftBar, ShiftSheet } from './ShiftBar';
import { Timeline } from './Timeline';
import type { DrawerDesc, Nav, PlansControl } from './shared';
import { useHotkeys } from './useHotkeys';

async function fullscreen() {
  try {
    await toggleFullscreen();
  } catch {
    /* denied or unsupported */
  }
}

/** The whole cook-along for one plan. `plans` opens the Plans drawer, which lives outside (see PlanHost). */
export function CookAlongUI({ api, plans }: { api: CookAlongApi; plans?: PlansControl }) {
  const [stack, setStack] = useState<DrawerDesc[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ message: string; yesLabel: string; onYes: () => void } | null>(null);
  const [view, setView] = useState<View>('dashboard');
  const [resetKey, setResetKey] = useState(0);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const root = document.documentElement;
    if (api.isTestMode) root.dataset.test = '1';
    else delete root.dataset.test;
    return () => {
      delete root.dataset.test;
    };
  }, [api.isTestMode]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const apiRef = useRef(api);
  apiRef.current = api;
  const plansRef = useRef(plans);
  plansRef.current = plans;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4500);
  }, []);

  const nav: Nav = useMemo(
    () => ({
      open: (d) => setStack((s) => [...s, d]),
      openRecipe: (id, occId) => setStack((s) => [...s, { kind: 'recipes', recipeId: id, occId }]),
      openRecipesFor: (occId) => setStack((s) => [...s, { kind: 'recipes', occId }]),
      openPlans: () => plansRef.current?.open(),
      fullscreen: () => void fullscreen(),
      openFallback: (id) => setStack((s) => [...s, { kind: 'problems', focusId: id }]),
      openTask: (occId) => setStack((s) => [...s, { kind: 'task', occId }]),
      confirm: (message, yesLabel, onYes) => setConfirm({ message, yesLabel, onYes }),
      shift: (minutes: number, scope: ShiftScope, label: string) => {
        // Fallback buttons already carry the amount in their label ('Traeger +15').
        const text = /\d/.test(label) ? label : `${label} ${minutes > 0 ? '+' : ''}${minutes}`;
        const n = apiRef.current.shift(minutes, scope, text);
        showToast(n > 0 ? `${text} min · ${n} task${n === 1 ? '' : 's'} moved` : `${text} min · nothing to move`);
      },
    }),
    [showToast],
  );

  const front = api.alerts[0];
  const plansOpen = plans?.isOpen ?? false;
  const overlayOpen = stack.length > 0 || confirm !== null || !api.started || plansOpen;

  useHotkeys({
    space: () => {
      const a = apiRef.current.alerts[0];
      if (!a || overlayOpen) return false;
      if (a.type === 'headsUp') apiRef.current.ackHeadsUp(a.occ.occId);
      else apiRef.current.done(a.occ.occId);
      return true;
    },
    snooze: (m) => {
      const a = apiRef.current.alerts[0];
      if (!a || overlayOpen) return false;
      if (a.type === 'headsUp') apiRef.current.ackHeadsUp(a.occ.occId);
      else apiRef.current.snooze(a.occ.occId, m);
      return true;
    },
    fullscreen: () => void fullscreen(),
    escape: () => {
      if (confirm) {
        setConfirm(null);
        return true;
      }
      if (plansOpen) {
        plansRef.current?.close();
        return true;
      }
      if (stack.length) {
        setStack((s) => s.slice(0, -1));
        return true;
      }
      return false;
    },
  });

  const pop = () => setStack((s) => s.slice(0, -1));
  const replaceTop = (d: DrawerDesc) => setStack((s) => [...s.slice(0, -1), d]);

  const renderDrawer = (d: DrawerDesc, i: number) => {
    const z = 150 + i * 2;
    switch (d.kind) {
      case 'task':
        return <TaskDrawer key={i} api={api} occId={d.occId} nav={nav} z={z} onClose={pop} />;
      case 'recipes':
        return <RecipesDrawer key={i} api={api} occId={d.occId} recipeId={d.recipeId} onChange={(n) => replaceTop({ kind: 'recipes', ...n })} z={z} onClose={pop} />;
      case 'shift':
        return <ShiftSheet key={i} api={api} nav={nav} z={z} onClose={pop} />;
      case 'problems':
        return <ProblemsDrawer key={i} api={api} focusId={d.focusId} nav={nav} z={z} onClose={pop} />;
      case 'temps':
        return <TempsDrawer key={i} api={api} z={z} onClose={pop} />;
      case 'settings':
        return <SettingsDrawer key={i} api={api} nav={nav} z={z} onClose={pop} />;
      default:
        return (
          <Drawer key={i} title="" z={z} onClose={pop}>
            {null}
          </Drawer>
        );
    }
  };

  return (
    <>
      <div className="app">
        <TestBanner api={api} />
        <Header
          api={api}
          view={view}
          setView={setView}
          onOpen={nav.open}
          onPlans={nav.openPlans}
          onRecipes={() => {
            if (view === 'schedule') setResetKey((k) => k + 1);
            else nav.open({ kind: 'recipes' });
          }}
        />
        <Banners api={api} />
        {view === 'dashboard' ? (
          <main className="dash">
            <div className="area-rail">
              <Timeline api={api} nav={nav} />
            </div>
            <div className="area-hero">
              <NowPanel api={api} nav={nav} />
              <ShiftBar nav={nav} />
            </div>
            <div className="area-board">
              <Board api={api} />
            </div>
          </main>
        ) : (
          <ScheduleView api={api} resetKey={resetKey} />
        )}
      </div>

      <Toasts api={api} message={toast} />
      {front && <AlertModal key={`${front.key}@${front.dueAt}`} api={api} alert={front} rest={api.alerts.slice(1)} nav={nav} />}
      {stack.map(renderDrawer)}
      {confirm && (
        <ConfirmDialog
          message={confirm.message}
          yesLabel={confirm.yesLabel}
          onYes={() => {
            const f = confirm.onYes;
            setConfirm(null);
            f();
          }}
          onNo={() => setConfirm(null)}
        />
      )}
      {!api.started && <StartOverlay api={api} onPlans={plans ? nav.openPlans : undefined} />}
      <PrintSheet api={api} />
    </>
  );
}
