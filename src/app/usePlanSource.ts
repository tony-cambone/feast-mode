/**
 * Which plan is active, plus importing your own (PlanSourceApi in ./api.ts).
 *
 *   const src = usePlanSource();
 *   <CookAlong key={src.plan.id} plan={src.plan} />   // remount on switch: progress is per plan
 *
 * Sources: the bundled plans (src/data/plan.ts) and imported plans saved in kv `tg:v1:plans`
 * (Record<planId, raw JSON>, re-validated on every load; invalid ones are skipped with a warning).
 * Active plan: `?plan=<id>` for this load, else kv `tg:v1:activePlan`, else the first bundled plan.
 * An imported plan with a bundled plan's id replaces it while imported (same progress namespace).
 */
import { useCallback, useRef, useState } from 'react';
import { bundledPlans } from '../data/plan';
import type { Plan } from '../data/types';
import { validatePlan } from '../data/validate';
import type { PlanValidation } from '../data/validate';
import { STORAGE_KEYS, migrateLegacyStorage } from '../engine';
import type { KV } from '../engine';
import type { PlanSourceApi, PlanSummary } from './api';
import { getDefaultKV } from './useCookAlong';

export interface PlanSourceDeps {
  kv: KV;
  bundled: readonly Plan[];
  validate: (raw: unknown) => PlanValidation;
  /** location.search, e.g. '?plan=sunday-roast'. */
  search: string;
  /** Remove `?plan=` from the address bar (after the cook picks a plan explicitly). */
  clearPlanParam: () => void;
  warn: (message: string) => void;
}

function defaultDeps(): PlanSourceDeps {
  return {
    kv: getDefaultKV(),
    bundled: bundledPlans,
    validate: validatePlan,
    search: typeof location !== 'undefined' ? location.search : '',
    clearPlanParam: () => {
      try {
        const url = new URL(location.href);
        if (!url.searchParams.has('plan')) return;
        url.searchParams.delete('plan');
        history.replaceState(history.state, '', url.toString());
      } catch {
        /* not in a browser */
      }
    },
    warn: (m) => console.warn(m),
  };
}

/* ------------------------------------------------------------------ pure helpers */

export type ParsedText = { ok: true; value: unknown; warnings: string[] } | { ok: false; errors: string[] };

/** 0-based character offset -> 1-based line/column. */
function lineCol(text: string, pos: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(pos, text.length)));
  const lines = before.split('\n');
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

/** Turn a JSON.parse error (V8, SpiderMonkey or JSC wording) into one friendly sentence + hints. */
export function describeJsonError(text: string, err: unknown): string[] {
  const raw = err instanceof Error ? err.message : String(err);
  let where: { line: number; column: number } | null = null;
  let msg = raw;
  const pos = /\s*in JSON at position (\d+)(?:\s*\(line \d+ column \d+\))?/.exec(raw);
  if (pos) {
    where = lineCol(text, Number(pos[1]));
    msg = raw.replace(pos[0], '');
  } else {
    const lc = /\s*at line (\d+) column (\d+)(?: of the JSON data)?/.exec(raw);
    if (lc) {
      where = { line: Number(lc[1]), column: Number(lc[2]) };
      msg = raw.replace(lc[0], '');
    }
  }
  msg = msg.replace(/^JSON(\.parse)?( Parse error)?:\s*/i, '').trim();
  const out = [`This isn't valid JSON${where ? ` (line ${where.line}, column ${where.column})` : ''}: ${msg}.`];
  if (where) {
    const lineText = text.split('\n')[where.line - 1];
    if (lineText !== undefined) out.push(`Line ${where.line}: ${lineText.trim().slice(0, 120)}`);
  }
  const hints: string[] = [];
  if (/,\s*[}\]]/.test(text)) hints.push('remove the comma after the last item in a list or object');
  if (/(^|[\s{,[])'[^'\n]*'\s*:/.test(text) || /:\s*'[^'\n]*'/.test(text)) hints.push('use "double quotes", not \'single quotes\'');
  if (/^\s*\/\//m.test(text) || /\/\*[\s\S]*?\*\//.test(text)) hints.push('delete comments (// or /* */): JSON has none');
  if (/[{,]\s*[A-Za-z_$][\w$]*\s*:/.test(text)) hints.push('put property names in double quotes ("title": …)');
  if (/[“”]/.test(text)) hints.push('replace curly quotes “ ” with straight quotes "');
  if (hints.length) out.push(`Common fixes: ${hints.join('; ')}.`);
  return out;
}

/**
 * Parse pasted/uploaded plan text. Forgiving about how AI chats wrap JSON: strips a BOM, a
 * surrounding ``` code fence, or prose before the first `{` / after the last `}` (with a warning).
 */
export function parsePlanText(text: unknown): ParsedText {
  if (typeof text !== 'string') return { ok: false, errors: ['Expected the plan as JSON text.'] };
  let t = text.replace(/^﻿/, '').trim();
  if (!t) return { ok: false, errors: ['The plan is empty. Paste the JSON text of a plan (it starts with "{").'] };
  const warnings: string[] = [];
  const fence = /^```[\w-]*[^\S\n]*\n([\s\S]*?)\n?```$/.exec(t);
  if (fence) {
    t = fence[1].trim();
    warnings.push('Removed the ``` code fence around the JSON.');
  }
  try {
    return { ok: true, value: JSON.parse(t), warnings };
  } catch (err) {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first > 0 || (last >= 0 && last < t.length - 1)) {
      try {
        const value = JSON.parse(t.slice(first, last + 1));
        warnings.push('Ignored text before or after the JSON object.');
        return { ok: true, value, warnings };
      } catch {
        /* report the original error */
      }
    }
    return { ok: false, errors: describeJsonError(t, err) };
  }
}

interface Imported {
  plans: Map<string, Plan>; // validated, by plan id
}

function readImported(d: PlanSourceDeps): Imported {
  const plans = new Map<string, Plan>();
  let raw: unknown;
  try {
    raw = d.kv.get<unknown>(STORAGE_KEYS.plans);
  } catch {
    raw = undefined;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { plans };
  for (const [key, json] of Object.entries(raw as Record<string, unknown>)) {
    let r: PlanValidation;
    try {
      r = d.validate(json);
    } catch (e) {
      r = { ok: false, errors: [String(e)], warnings: [] };
    }
    if (r.ok) plans.set(r.plan.id, r.plan);
    else d.warn(`Skipping saved plan "${key}": it no longer validates (${r.errors.slice(0, 3).join('; ')}${r.errors.length > 3 ? '; …' : ''}).`);
  }
  return { plans };
}

/** Bundled first (an imported plan with the same id takes its place), then imported-only plans. */
function allPlans(bundled: readonly Plan[], imported: Map<string, Plan>): { byId: Map<string, Plan>; available: PlanSummary[] } {
  const byId = new Map<string, Plan>();
  const available: PlanSummary[] = [];
  const add = (p: Plan, source: PlanSummary['source']) => {
    if (byId.has(p.id)) return;
    byId.set(p.id, p);
    available.push({ id: p.id, title: p.title, ...(p.emoji ? { emoji: p.emoji } : {}), source });
  };
  for (const b of bundled) {
    const shadow = imported.get(b.id);
    add(shadow ?? b, shadow ? 'imported' : 'bundled');
  }
  for (const p of imported.values()) add(p, 'imported');
  return { byId, available };
}

/** First candidate id that exists, else the first available plan. */
function pickActive(candidates: (string | null | undefined)[], byId: Map<string, Plan>, available: PlanSummary[]): string {
  for (const c of candidates) if (c && byId.has(c)) return c;
  if (available.length === 0) throw new Error('usePlanSource: no plans available (bundledPlans is empty).');
  return available[0].id;
}

/* ------------------------------------------------------------------ hook */

export function usePlanSource(deps?: Partial<PlanSourceDeps>): PlanSourceApi {
  const depsRef = useRef<PlanSourceDeps | null>(null);
  if (!depsRef.current) depsRef.current = { ...defaultDeps(), ...(deps ?? {}) };
  const d = depsRef.current;

  const stateRef = useRef<{ imported: Map<string, Plan>; activeId: string } | null>(null);
  if (!stateRef.current) {
    try {
      migrateLegacyStorage(d.kv);
    } catch {
      /* never fatal */
    }
    const { plans: imported } = readImported(d);
    const { byId, available } = allPlans(d.bundled, imported);
    let param: string | null = null;
    try {
      param = new URLSearchParams(d.search).get('plan');
    } catch {
      param = null;
    }
    if (param && !byId.has(param)) d.warn(`?plan=${param}: no such plan (available: ${available.map((a) => a.id).join(', ')}).`);
    let stored: unknown;
    try {
      stored = d.kv.get<unknown>(STORAGE_KEYS.activePlan);
    } catch {
      stored = undefined;
    }
    const activeId = pickActive([param, typeof stored === 'string' ? stored : null], byId, available);
    stateRef.current = { imported, activeId };
  }
  const [state, setState] = useState(stateRef.current);
  const commit = useCallback((next: { imported: Map<string, Plan>; activeId: string }) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const { byId, available } = allPlans(d.bundled, state.imported);
  const plan = byId.get(state.activeId) ?? byId.get(available[0]?.id ?? '')!;

  const activate = useCallback(
    (id: string) => {
      const dd = depsRef.current!;
      const cur = stateRef.current!;
      const all = allPlans(dd.bundled, cur.imported);
      if (!all.byId.has(id)) {
        dd.warn(`activate: no plan "${id}".`);
        return;
      }
      try {
        dd.kv.set(STORAGE_KEYS.activePlan, id);
      } catch {
        /* kv never throws, but be safe */
      }
      try {
        dd.clearPlanParam();
      } catch {
        /* ignore */
      }
      if (cur.activeId !== id) commit({ ...cur, activeId: id });
    },
    [commit],
  );

  const importPlan = useCallback(
    (text: string): ReturnType<PlanSourceApi['importPlan']> => {
      const dd = depsRef.current!;
      const parsed = parsePlanText(text);
      if (!parsed.ok) return { ok: false, errors: parsed.errors, warnings: [] };
      let r: PlanValidation;
      try {
        r = dd.validate(parsed.value);
      } catch (e) {
        r = { ok: false, errors: [`The validator crashed: ${String(e)}`], warnings: [] };
      }
      const warnings = [...parsed.warnings, ...r.warnings];
      if (!r.ok) return { ok: false, errors: r.errors, warnings };
      const p = r.plan;
      const cur = stateRef.current!;
      if (!cur.imported.has(p.id) && dd.bundled.some((b) => b.id === p.id)) {
        warnings.push(
          `This replaces the built-in plan "${p.id}" while it is imported (saved progress for "${p.id}" is kept). Remove it to get the built-in version back.`,
        );
      }
      let stored: Record<string, unknown> = {};
      try {
        const prev = dd.kv.get<unknown>(STORAGE_KEYS.plans);
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) stored = { ...(prev as Record<string, unknown>) };
      } catch {
        stored = {};
      }
      stored[p.id] = parsed.value;
      let saved = false;
      try {
        saved = dd.kv.set(STORAGE_KEYS.plans, stored);
      } catch {
        saved = false;
      }
      if (!saved) warnings.push("Couldn't save the plan in this browser's storage: it works now, but it will be gone after a reload.");
      const imported = new Map(cur.imported);
      imported.set(p.id, p);
      commit({ imported, activeId: cur.activeId });
      activate(p.id);
      return { ok: true, plan: p, warnings };
    },
    [activate, commit],
  );

  const removeImported = useCallback(
    (id: string) => {
      const dd = depsRef.current!;
      const cur = stateRef.current!;
      if (!cur.imported.has(id)) return;
      try {
        const prev = dd.kv.get<unknown>(STORAGE_KEYS.plans);
        if (prev && typeof prev === 'object' && !Array.isArray(prev)) {
          const next = { ...(prev as Record<string, unknown>) };
          delete next[id];
          dd.kv.set(STORAGE_KEYS.plans, next);
        }
      } catch {
        /* ignore */
      }
      const imported = new Map(cur.imported);
      imported.delete(id);
      let activeId = cur.activeId;
      if (activeId === id) {
        const all = allPlans(dd.bundled, imported);
        activeId = pickActive([id], all.byId, all.available); // the bundled plan it shadowed, else the first
        try {
          dd.kv.set(STORAGE_KEYS.activePlan, activeId);
        } catch {
          /* ignore */
        }
      }
      commit({ imported, activeId });
    },
    [commit],
  );

  const exportActive = useCallback(() => {
    const cur = stateRef.current!;
    const all = allPlans(depsRef.current!.bundled, cur.imported);
    const p = all.byId.get(cur.activeId) ?? all.byId.get(all.available[0]?.id ?? '');
    return `${JSON.stringify(p, null, 2)}\n`;
  }, []);

  return { plan, available, activate, importPlan, removeImported, exportActive };
}
