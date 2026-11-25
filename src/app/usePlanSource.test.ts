// @vitest-environment jsdom
import { StrictMode, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bundledPlans } from '../data/plan';
import type { Plan } from '../data/types';
import { validatePlan } from '../data/validate';
import { STORAGE_KEYS, createKV } from '../engine';
import type { KV } from '../engine';
import { fixturePlan, roastPlan } from '../engine/testFixture';
import type { PlanSourceApi } from './api';
import { describeJsonError, parsePlanText, usePlanSource } from './usePlanSource';
import type { PlanSourceDeps } from './usePlanSource';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class MemStorage implements Storage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  clear() { this.data.clear(); }
  getItem(k: string) { return this.data.get(k) ?? null; }
  key(i: number) { return [...this.data.keys()][i] ?? null; }
  removeItem(k: string) { this.data.delete(k); }
  setItem(k: string, v: string) { this.data.set(k, String(v)); }
}
class ThrowingStorage extends MemStorage {
  override getItem(): string | null { throw new Error('blocked'); }
  override setItem(): void { throw new Error('blocked'); }
}

const mounted: (() => void)[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!();
});

function deps(over: Partial<PlanSourceDeps> = {}) {
  const warnings: string[] = [];
  const cleared = { n: 0 };
  const d: PlanSourceDeps = {
    kv: createKV(new MemStorage()),
    bundled: [fixturePlan],
    validate: validatePlan,
    search: '',
    clearPlanParam: () => void cleared.n++,
    warn: (m) => void warnings.push(m),
    ...over,
  };
  return { d, warnings, cleared };
}

function mount(d: Partial<PlanSourceDeps>) {
  const ref: { api: PlanSourceApi | null } = { api: null };
  function Probe() {
    ref.api = usePlanSource(d);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  act(() => root.render(createElement(StrictMode, null, createElement(Probe))));
  const unmount = () => act(() => root.unmount());
  mounted.push(unmount);
  return {
    get api() {
      return ref.api!;
    },
  };
}

const roastJSON = JSON.stringify(roastPlan, null, 2);

describe('usePlanSource', () => {
  it('defaults to the first bundled plan and lists the bundled plans', () => {
    const { d } = deps({ bundled: [fixturePlan, roastPlan] });
    const h = mount(d);
    expect(h.api.plan.id).toBe('fixture');
    expect(h.api.available).toEqual([
      { id: 'fixture', title: 'Fixture', source: 'bundled' },
      { id: 'roast', title: 'Sunday roast', emoji: '🍗', source: 'bundled' },
    ]);
  });

  it('imports a valid plan: validated, stored, activated, and still there after a reload', () => {
    const backing = new MemStorage();
    const { d } = deps({ kv: createKV(backing) });
    const h = mount(d);
    let r!: ReturnType<PlanSourceApi['importPlan']>;
    act(() => {
      r = h.api.importPlan(roastJSON);
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.id).toBe('roast');
    expect(h.api.plan.id).toBe('roast');
    expect(h.api.plan.timeZone).toBe('Europe/London');
    expect(h.api.available.map((a) => [a.id, a.source])).toEqual([['fixture', 'bundled'], ['roast', 'imported']]);
    expect(Object.keys(JSON.parse(backing.getItem(STORAGE_KEYS.plans)!))).toEqual(['roast']);
    expect(JSON.parse(backing.getItem(STORAGE_KEYS.activePlan)!)).toBe('roast');

    const again = mount(deps({ kv: createKV(backing) }).d);
    expect(again.api.plan.id).toBe('roast');
    expect(again.api.available.map((a) => a.id)).toEqual(['fixture', 'roast']);
    expect(JSON.parse(again.api.exportActive())).toEqual(JSON.parse(JSON.stringify(again.api.plan)));
  });

  it('rejects an invalid plan with the validator errors; nothing changes', () => {
    const { d } = deps();
    const h = mount(d);
    const bad = { ...roastPlan, tasks: [{ ...roastPlan.tasks[0], devices: [{ device: 'ovn', set: 200 }] }] };
    let r!: ReturnType<PlanSourceApi['importPlan']>;
    act(() => {
      r = h.api.importPlan(JSON.stringify(bad));
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.join('\n')).toMatch(/ovn/);
    expect(h.api.plan.id).toBe('fixture');
    expect(h.api.available).toHaveLength(1);
    expect(d.kv.get(STORAGE_KEYS.plans)).toBeUndefined();
  });

  it('JSON syntax errors are friendly: line/column, the line, and a hint', () => {
    const { d } = deps();
    const h = mount(d);
    const text = '{\n  "id": "x",\n  "title": "Roast",\n}';
    let r!: ReturnType<PlanSourceApi['importPlan']>;
    act(() => {
      r = h.api.importPlan(text);
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/^This isn't valid JSON \(line 4, column 1\): /);
    expect(r.errors[1]).toBe('Line 4: }');
    expect(r.errors.at(-1)).toMatch(/remove the comma after the last item/);
    expect(h.api.plan.id).toBe('fixture');
    act(() => {
      r = h.api.importPlan('   ');
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/empty/);
  });

  it('?plan=<id> overrides the stored active plan for this load only', () => {
    const kv = createKV(new MemStorage());
    kv.set(STORAGE_KEYS.activePlan, 'fixture');
    const { d, cleared } = deps({ kv, bundled: [fixturePlan, roastPlan], search: '?plan=roast' });
    const h = mount(d);
    expect(h.api.plan.id).toBe('roast');
    expect(kv.get(STORAGE_KEYS.activePlan)).toBe('fixture'); // not persisted
    // Picking a plan explicitly persists it and drops ?plan= from the address bar.
    act(() => h.api.activate('fixture'));
    expect(h.api.plan.id).toBe('fixture');
    expect(kv.get(STORAGE_KEYS.activePlan)).toBe('fixture');
    expect(cleared.n).toBe(1);
    // Unknown ?plan= falls back with a warning.
    const u = deps({ kv, bundled: [fixturePlan, roastPlan], search: '?plan=nope' });
    expect(mount(u.d).api.plan.id).toBe('fixture');
    expect(u.warnings.some((w) => w.includes('?plan=nope'))).toBe(true);
  });

  it('skips stored plans that no longer validate, with a console warning', () => {
    const kv = createKV(new MemStorage());
    kv.set(STORAGE_KEYS.plans, { broken: { id: 'broken', title: 'x' }, roast: JSON.parse(roastJSON) });
    kv.set(STORAGE_KEYS.activePlan, 'broken');
    const { d, warnings } = deps({ kv });
    const h = mount(d);
    expect(h.api.available.map((a) => a.id)).toEqual(['fixture', 'roast']);
    expect(h.api.plan.id).toBe('fixture');
    expect(warnings.some((w) => w.startsWith('Skipping saved plan "broken"'))).toBe(true);
  });

  it('the default warn is console.warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const kv = createKV(new MemStorage());
    kv.set(STORAGE_KEYS.plans, { broken: 42 });
    const { warn: _ignored, ...rest } = deps({ kv }).d;
    mount(rest);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('migrates old single-plan keys into the thanksgiving-2026 namespace on load', () => {
    const backing = new MemStorage();
    backing.setItem('tg:v1:day:real', JSON.stringify({ version: 1, occ: { 'thu-0700': { doneAt: 1 } } }));
    backing.setItem('tg:v1:day:test', JSON.stringify({ version: 1, occ: { 'thu-0800': { doneAt: 2 } } }));
    backing.setItem('tg:v1:prefs', JSON.stringify({ version: 1, settings: {}, checks: { 'gravy:ing:0': true } }));
    mount(deps({ kv: createKV(backing) }).d);
    expect(JSON.parse(backing.getItem('tg:v1:day:thanksgiving-2026:real')!).occ).toEqual({ 'thu-0700': { doneAt: 1 } });
    expect(JSON.parse(backing.getItem('tg:v1:day:thanksgiving-2026:test')!).occ).toEqual({ 'thu-0800': { doneAt: 2 } });
    expect(JSON.parse(backing.getItem('tg:v1:prefs:thanksgiving-2026')!).checks).toEqual({ 'gravy:ing:0': true });
  });

  it('an imported plan with a bundled id replaces it until removed', () => {
    const { d } = deps({ bundled: [fixturePlan, roastPlan] });
    const h = mount(d);
    const edited = { ...roastPlan, title: 'Sunday roast (edited)' };
    let r!: ReturnType<PlanSourceApi['importPlan']>;
    act(() => {
      r = h.api.importPlan(JSON.stringify(edited));
    });
    expect(r.ok && r.warnings.some((w) => w.includes('replaces the built-in plan "roast"'))).toBe(true);
    expect(h.api.plan.title).toBe('Sunday roast (edited)');
    expect(h.api.available.map((a) => [a.id, a.source])).toEqual([['fixture', 'bundled'], ['roast', 'imported']]);
    act(() => h.api.removeImported('roast'));
    expect(h.api.plan.id).toBe('roast');
    expect(h.api.plan.title).toBe('Sunday roast');
    expect(h.api.available.map((a) => a.source)).toEqual(['bundled', 'bundled']);
  });

  it('removing the active imported plan falls back to the first bundled plan', () => {
    const { d } = deps();
    const h = mount(d);
    act(() => void h.api.importPlan(roastJSON));
    expect(h.api.plan.id).toBe('roast');
    act(() => h.api.removeImported('roast'));
    expect(h.api.plan.id).toBe('fixture');
    expect(d.kv.get(STORAGE_KEYS.plans)).toEqual({});
    expect(d.kv.get(STORAGE_KEYS.activePlan)).toBe('fixture');
  });

  it('with storage blocked, an import still works for this session (with a warning)', () => {
    const kv: KV = createKV(new ThrowingStorage());
    const { d } = deps({ kv });
    const h = mount(d);
    let r!: ReturnType<PlanSourceApi['importPlan']>;
    act(() => {
      r = h.api.importPlan(roastJSON);
    });
    expect(r.ok).toBe(true);
    expect(r.warnings.some((w) => w.includes("Couldn't save"))).toBe(true);
    expect(h.api.plan.id).toBe('roast');
  });

  it('the real bundled plans load and are listed', () => {
    const h = mount(deps({ bundled: bundledPlans }).d);
    expect(h.api.available.map((a) => a.id)).toEqual(bundledPlans.map((p: Plan) => p.id));
    expect(h.api.available.map((a) => a.id)).toContain('thanksgiving-2026');
    expect(h.api.plan.id).toBe(bundledPlans[0].id);
  });
});

describe('parsePlanText', () => {
  it('strips a BOM, a ``` fence, or chat prose around the object', () => {
    expect(parsePlanText('﻿{"a":1}')).toEqual({ ok: true, value: { a: 1 }, warnings: [] });
    expect(parsePlanText('```json\n{"a":1}\n```')).toEqual({ ok: true, value: { a: 1 }, warnings: ['Removed the ``` code fence around the JSON.'] });
    expect(parsePlanText('Here is your plan:\n{"a":1}\nEnjoy!')).toEqual({
      ok: true,
      value: { a: 1 },
      warnings: ['Ignored text before or after the JSON object.'],
    });
    expect(parsePlanText(42)).toMatchObject({ ok: false });
  });

  it('hints for the usual AI/hand-edit mistakes', () => {
    const errs = (t: string) => {
      const r = parsePlanText(t);
      return r.ok ? [] : r.errors;
    };
    expect(errs("{'id': 'x'}").join(' ')).toMatch(/double quotes/);
    expect(errs('{\n  // comment\n  "id": "x"\n}').join(' ')).toMatch(/delete comments/);
    expect(errs('{ id: "x" }').join(' ')).toMatch(/property names in double quotes/);
    expect(errs('{ “id”: “x” }').join(' ')).toMatch(/curly quotes/);
  });

  it('describeJsonError understands Firefox wording and position-less errors', () => {
    const t = '{\n "a": 1,\n}';
    expect(describeJsonError(t, new SyntaxError('JSON.parse: expected double-quoted property name at line 3 column 1 of the JSON data'))[0]).toBe(
      "This isn't valid JSON (line 3, column 1): expected double-quoted property name.",
    );
    expect(describeJsonError(t, new SyntaxError("JSON Parse error: Expected '}'"))[0]).toBe("This isn't valid JSON: Expected '}'.");
  });
});
