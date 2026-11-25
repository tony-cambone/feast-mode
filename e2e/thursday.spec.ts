/**
 * End-to-end runs in a real Chrome (installed channel) against the production build.
 *
 *   npm run e2e                     # all tests (the Thursday run takes ~8.5 min at 60×)
 *   E2E_SPEED=300 npm run e2e       # faster rehearsal of the same run
 *
 * The app is put into test mode by seeding the clock config in localStorage before load,
 * and window.Notification is replaced with a recorder so we can assert desktop notifications.
 */
import { expect, test, type Page } from '@playwright/test';
import { plan } from '../src/data/plan';
import { dayById } from '../src/data/types';
import { buildOccurrences, lanesOf, resolveTasks, zonedToEpoch } from '../src/engine';

const SPEED = Number(process.env.E2E_SPEED ?? 60);

type Seen = { type: string; occId: string; title: string; alarm: string; appTime: number };

/** Seed test clock + notification recorder. Runs before every navigation; seeds the clock only once per tab. */
async function seed(page: Page, opts: { appTime?: number; speed?: number; blockStorage?: boolean }) {
  const baseReal = Date.now();
  await page.addInitScript(
    ({ appTime, speed, baseReal, blockStorage }) => {
      const w = window as unknown as { __notifs: { title: string; tag?: string; at: number }[] };
      w.__notifs = [];
      class FakeNotification {
        static permission = 'granted';
        static requestPermission = () => Promise.resolve('granted');
        onclick: null | (() => void) = null;
        constructor(title: string, o?: { tag?: string }) {
          w.__notifs.push({ title, tag: o?.tag, at: Date.now() });
        }
        close() {}
        addEventListener() {}
        removeEventListener() {}
      }
      Object.defineProperty(window, 'Notification', { value: FakeNotification, configurable: true, writable: true });

      if (blockStorage) {
        Object.defineProperty(window, 'localStorage', {
          configurable: true,
          get() {
            throw new DOMException('blocked by test', 'SecurityError');
          },
        });
        return;
      }
      if (appTime != null && !sessionStorage.getItem('e2e-seeded')) {
        sessionStorage.setItem('e2e-seeded', '1');
        localStorage.setItem('tg:v1:clock', JSON.stringify({ mode: 'test', baseReal, baseApp: appTime, speed }));
      }
    },
    { appTime: opts.appTime ?? null, speed: opts.speed ?? SPEED, baseReal, blockStorage: !!opts.blockStorage },
  );
  return {
    baseReal,
    appNow: () => (opts.appTime ?? 0) + (Date.now() - baseReal) * (opts.speed ?? SPEED),
  };
}

async function startDay(page: Page) {
  await page.goto(`/?plan=${plan.id}`);
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('start-button')).toBeHidden();
}

const thu = (hhmm: string) => zonedToEpoch(dayById(plan, 'thu')!.date, hhmm, plan.timeZone);

test('Thursday at test speed: every alert fires in order with sound + notification; heads-ups 5 min early', async ({ page }) => {
  const start = thu('06:55');
  const end = thu('15:10');
  test.setTimeout(((end - start) / SPEED) * 1.5 + 120_000);

  const clock = await seed(page, { appTime: start });
  await startDay(page);
  await expect(page.getByTestId('test-mode-banner')).toBeVisible();

  const occs = buildOccurrences(plan, resolveTasks(plan, []), {}).filter((o) => o.day === 'thu');
  const expectedMain = occs.filter((o) => (o.task.alert ?? 'modal') === 'modal');
  const expectedHeads = occs.filter((o) => o.task.headsUpMin);
  const byId = new Map(occs.map((o) => [o.occId, o]));

  const seen: Seen[] = [];
  const modal = page.getByTestId('alert-modal');
  while (clock.appNow() < end) {
    if (await modal.isVisible()) {
      const type = (await modal.getAttribute('data-alert-type')) ?? '';
      const occId = (await modal.getAttribute('data-occ-id')) ?? '';
      const title = (await page.getByTestId('alert-title').textContent()) ?? '';
      const alarm = await page.evaluate(() => document.documentElement.dataset.alarm ?? 'missing');
      seen.push({ type, occId, title, alarm, appTime: clock.appNow() });
      await page.keyboard.press('Space');
      // wait for this alert to leave the front
      await expect
        .poll(async () => ((await modal.isVisible()) ? `${await modal.getAttribute('data-alert-type')}|${await modal.getAttribute('data-occ-id')}` : ''))
        .not.toBe(`${type}|${occId}`);
    } else {
      await page.waitForTimeout(100);
    }
  }

  const mains = seen.filter((s) => s.type === 'main');
  const heads = seen.filter((s) => s.type === 'headsUp');

  // every modal task fired exactly once
  expect(mains.map((s) => s.occId).sort()).toEqual(expectedMain.map((o) => o.occId).sort());
  // ...in time order, never early (allow one tick of slack)
  const tick = 250 * SPEED;
  for (let i = 0; i < mains.length; i++) {
    const o = byId.get(mains[i].occId)!;
    expect(mains[i].appTime, `${o.occId} fired early`).toBeGreaterThanOrEqual(o.time - tick);
    if (i > 0) expect(o.time).toBeGreaterThanOrEqual(byId.get(mains[i - 1].occId)!.time);
  }
  // heads-ups: one per task with headsUpMin, ~5 min before its main time
  expect(heads.map((s) => s.occId).sort()).toEqual(expectedHeads.map((o) => o.occId).sort());
  for (const h of heads) {
    const o = byId.get(h.occId)!;
    const lead = (o.time - h.appTime) / 60_000;
    expect(lead, `${o.occId} heads-up lead`).toBeGreaterThan(0);
    expect(lead).toBeLessThanOrEqual(o.task.headsUpMin! + 0.5);
  }
  // sound was playing for every alert; critical ones used the loud alarm
  for (const s of seen) expect(s.alarm, `${s.occId} sound`).not.toMatch(/off|missing/);
  for (const s of mains) if (byId.get(s.occId)!.task.critical) expect(s.alarm).toBe('alarm');
  // a desktop notification accompanied every firing
  const notifs = await page.evaluate(() => (window as unknown as { __notifs: unknown[] }).__notifs.length);
  expect(notifs).toBeGreaterThanOrEqual(seen.length);

  await expect(modal).toBeHidden();
});

test('Snooze 5 / 10 re-fire, Done persists through reload, keyboard shortcuts', async ({ page }) => {
  const clock = await seed(page, { appTime: thu('09:15') + 30_000, speed: 60 });
  await startDay(page);
  const modal = page.getByTestId('alert-modal');
  // earlier Thursday tasks (07:00–08:45) are also due and stack in front: clear them with Space
  for (let i = 0; i < 10; i++) {
    await expect(modal).toBeVisible();
    if ((await modal.getAttribute('data-occ-id')) === 'thu-0915') break;
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  await expect(modal).toHaveAttribute('data-occ-id', 'thu-0915');

  await page.keyboard.press('s'); // snooze 5 → back after 5 app-min ≈ 5 s
  await expect(modal).toBeHidden();
  const t0 = clock.appNow();
  await expect(modal).toHaveAttribute('data-occ-id', 'thu-0915', { timeout: 20_000 });
  expect(clock.appNow() - t0).toBeGreaterThanOrEqual(4 * 60_000);

  await page.keyboard.press('Shift+S'); // snooze 10 ≈ 10 s
  await expect(modal).toBeHidden();
  const t1 = clock.appNow();
  await expect(modal).toHaveAttribute('data-occ-id', 'thu-0915', { timeout: 30_000 });
  expect(clock.appNow() - t1).toBeGreaterThanOrEqual(9 * 60_000);

  await page.keyboard.press('Space');
  await expect(page.getByTestId('timeline-row-thu-0915')).toHaveAttribute('data-status', 'done');

  await page.reload();
  await page.getByTestId('start-button').click();
  await expect(page.getByTestId('timeline-row-thu-0915')).toHaveAttribute('data-status', 'done');
});

test('Running late +15 on the Oven lane shifts only oven tasks and updates the board', async ({ page }) => {
  await seed(page, { appTime: thu('10:05'), speed: 1 });
  await startDay(page);
  // dismiss anything already due so the modal doesn't cover the controls
  const modal = page.getByTestId('alert-modal');
  while (await modal.isVisible()) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
  await page.getByTestId('shift-more').click(); // open the running-late sheet
  await page.getByTestId('lane-oven').click(); // pick the Oven lane chip, then +15
  await page.getByTestId('shift-oven-15').click();

  const day = await page.evaluate(() => JSON.parse(localStorage.getItem('tg:v1:day:thanksgiving-2026:test') ?? '{}'));
  const shifted = Object.keys(day.shifts ?? {});
  expect(shifted.length).toBeGreaterThan(0);
  const tasks = new Map(resolveTasks(plan, []).map((t) => [t.id, t]));
  for (const occId of shifted) {
    const t = tasks.get(occId.split('@')[0])!;
    expect(lanesOf(t, plan), `${occId} is not an oven task`).toContain('oven');
    expect(t.day, `${occId} is not today`).toBe('thu');
    expect(day.shifts[occId]).toBe(15);
  }
  expect(shifted).toContain('thu-1015');
  expect(shifted).toContain('thu-1255');
  expect(shifted).not.toContain('thu-0915'); // Traeger, past
  expect(shifted).not.toContain('thu-1245'); // Traeger: an oven delay must not move the big bird
  expect(shifted).not.toContain('thu-1220'); // grill only
  expect(shifted).not.toContain('thu-1255-grill'); // mushrooms come off on their own clock
  // oven is still preheating (turkey now goes in at 10:30), board says 425°F
  await expect(page.getByTestId('board-oven')).toHaveAttribute('data-setting', '425');
});

test('Works with localStorage blocked (state just does not persist)', async ({ page }) => {
  await seed(page, { blockStorage: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await startDay(page);
  await expect(page.getByTestId('now-panel')).toBeVisible();
  await expect(page.getByText(/won.t survive a reload/i)).toBeVisible();
  expect(errors).toEqual([]);
});
