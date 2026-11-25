import { useEffect, useMemo, useRef, useState } from 'react';
import type { CookAlongApi } from '../app/api';
import type { Day } from '../data/types';
import { epochToZoned } from '../engine';
import type { DeviceSpan, Occurrence } from '../engine/types';
import { MIN, busiestStart, chipsFor, dayLabel, deviceIcon, deviceName, fmtHHMM, previewOf, settingText } from './format';
import { RecipePanelBody } from './RecipePanel';
import { centerIn, statusIcon } from './Timeline';
import { Btn, Seg } from './shared';

interface Sel {
  occId?: string;
  recipeId?: string;
}

const ROW_H = 30; // one row of item bars
const BAND_H = 24; // setting label strip at the top of a lane

/** Whole-day equipment chart: one lane per plan device, setting bands, item bars, task ticks, the now line. */
function Gantt({ api, day, occs, sel, onSelect, zoom }: { api: CookAlongApi; day: Day; occs: Occurrence[]; sel?: string; onSelect: (occId: string) => void; zoom: boolean }) {
  const { plan } = api;
  const tz = plan.timeZone;
  const daySpans: DeviceSpan[] = api.spans?.[day] ?? [];
  if (!occs.length) return null;

  const dayT0 = occs[0].time - 30 * MIN;
  const dayT1 = Math.max(occs[occs.length - 1].time + 30 * MIN, ...daySpans.map((s) => s.end));
  const nowInDay = api.now >= dayT0 && api.now <= dayT1;
  let t0 = dayT0;
  let t1 = dayT1;
  if (zoom) {
    // 3 hours around now; on another day, 3 hours around that day's busiest half hour.
    const anchor = nowInDay ? api.now : (busiestStart(occs) ?? occs[0].time);
    t0 = anchor - 60 * MIN;
    t1 = anchor + 120 * MIN;
  }
  const spans = daySpans.filter((x) => x.end > t0 && x.start < t1);
  const ticks = occs.filter((o) => o.time >= t0 && o.time <= t1);
  const span = t1 - t0;
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - t0) / span) * 100));

  // Axis labels on the hour (half hours when zoomed, every 2 h for very long days).
  const stepMin = zoom ? 30 : span > 13 * 60 * MIN ? 120 : 60;
  const z = epochToZoned(t0, tz);
  const floorHour = t0 - z.ss * 1000 - z.mm * MIN;
  const hours: number[] = [];
  for (let k = 0; floorHour + k * 30 * MIN <= t1; k++) {
    const t = floorHour + k * 30 * MIN;
    if (t >= t0 && (z.hh * 60 + k * 30) % stepMin === 0) hours.push(t);
  }
  const showNow = api.now >= t0 && api.now <= t1;

  return (
    <div className="gantt" data-testid="gantt">
      <div className="g-overlay g-under" aria-hidden="true">
        {hours.map((h) => (
          <div key={h} className="g-grid" style={{ left: `${pct(h)}%` }} />
        ))}
      </div>
      {showNow && (
        <div className="g-overlay g-over" aria-hidden="true">
          <div className="g-now" data-testid="gantt-now" style={{ left: `${pct(api.now)}%` }}>
            <span>{fmtHHMM(api.now, tz)}</span>
          </div>
        </div>
      )}
      <div className="g-row g-axis">
        <div className="g-label" />
        <div className="g-plot">
          {hours
            .filter((h) => !showNow || Math.abs(pct(h) - pct(api.now)) > 5)
            .map((h) => (
              <span key={h} className={`g-hour${pct(h) > 96 ? ' g-hour-end' : pct(h) < 4 ? ' g-hour-start' : ''}`} style={{ left: `${pct(h)}%` }}>
                {fmtHHMM(h, tz)}
              </span>
            ))}
        </div>
      </div>
      {plan.devices.map((dev) => {
        const settings = spans.filter((s) => s.device === dev.id && s.kind === 'setting' && s.setting !== 'OFF');
        const items = spans.filter((s) => s.device === dev.id && s.kind === 'item').sort((a, b) => a.start - b.start);
        const rowEnds: number[] = [];
        const placed = items.map((it) => {
          let r = rowEnds.findIndex((e) => e <= it.start);
          if (r < 0) r = rowEnds.length;
          rowEnds[r] = it.end;
          return { it, r };
        });
        const rows = Math.max(1, rowEnds.length);
        const icon = deviceIcon(plan, dev.id);
        const idle = settings.length === 0 && items.length === 0;
        return (
          <div key={dev.id} className={`g-row g-lane${idle ? ' g-idle' : ''}`} data-testid={`gantt-lane-${dev.id}`}>
            <div className="g-label">
              {icon && <span aria-hidden="true">{icon} </span>}
              {deviceName(plan, dev.id, true)}
            </div>
            <div className="g-plot" style={{ height: BAND_H + rows * ROW_H + 4 }}>
              {settings.map((s, i) => (
                <button
                  key={`s${i}`}
                  type="button"
                  className={`g-band${sel === s.occId ? ' g-sel' : ''}`}
                  style={{ left: `${pct(s.start)}%`, width: `${Math.max(0.6, pct(s.end) - pct(s.start))}%` }}
                  onClick={() => onSelect(s.occId)}
                  title={`${settingText(plan, s.setting ?? s.label)} ${fmtHHMM(s.start, tz)}–${fmtHHMM(s.end, tz)}`}
                >
                  <span>{s.setting !== undefined ? settingText(plan, s.setting) : s.label}</span>
                </button>
              ))}
              {placed.map(({ it, r }, i) => (
                <button
                  key={`i${i}`}
                  type="button"
                  className={`g-bar${sel === it.occId ? ' g-sel' : ''}`}
                  style={{ left: `${pct(it.start)}%`, width: `${Math.max(0.9, pct(it.end) - pct(it.start))}%`, top: BAND_H + r * ROW_H }}
                  onClick={() => onSelect(it.occId)}
                  title={`${it.label} ${fmtHHMM(it.start, tz)}–${fmtHHMM(it.end, tz)}`}
                >
                  <span>{it.label}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
      <div className="g-row g-ticks">
        <div className="g-label">Tasks</div>
        <div className="g-plot">
          {ticks.map((o) => (
            <button
              key={o.occId}
              type="button"
              className={`g-tick${o.task.critical ? ' g-tick-crit' : ''}${sel === o.occId ? ' g-tick-sel' : ''}${api.statusOf(o.occId) === 'done' ? ' g-tick-done' : ''}`}
              style={{ left: `${pct(o.time)}%` }}
              onClick={() => onSelect(o.occId)}
              title={`${fmtHHMM(o.time, tz)} ${o.task.title}${o.shiftMin ? ` (shifted ${o.shiftMin > 0 ? '+' : ''}${o.shiftMin})` : ''}`}
              aria-label={`${fmtHHMM(o.time, tz)} ${o.task.title}`}
            >
              <i />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Schedule: day tabs, the equipment chart, the full task list, and recipes in a side panel. */
export function ScheduleView({ api, resetKey }: { api: CookAlongApi; resetKey: number }) {
  const { plan } = api;
  const tz = plan.timeZone;
  const [tab, setTab] = useState<Day>(api.boardDay);
  const [sel, setSel] = useState<Sel>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [zoom, setZoom] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  const narrow = () => window.innerWidth < 1100;

  const lastKey = useRef(resetKey);
  useEffect(() => {
    if (lastKey.current === resetKey) return;
    lastKey.current = resetKey;
    setSel({});
    if (narrow()) setPanelOpen(true);
  }, [resetKey]);

  const occs = useMemo(() => api.occurrences.filter((o) => o.day === tab), [api.occurrences, tab]);
  const cur = api.nowNext.current[0] ?? api.nowNext.lastStarted;
  const currentId = cur && cur.day === tab ? cur.occId : undefined;
  const nowOnTab = api.boardDay === tab;

  useEffect(() => {
    const list = listRef.current;
    if (!list || !currentId) return;
    const el = Array.from(list.children).find((c) => (c as HTMLElement).dataset.occ === currentId) as HTMLElement | undefined;
    if (el) centerIn(list, el);
  }, [currentId, tab]);

  const select = (occId: string) => {
    setSel({ occId });
    if (narrow()) setPanelOpen(true);
  };

  const items: { hour?: string; occ?: Occurrence }[] = [];
  let lastHour = '';
  for (const o of occs) {
    const h = `${fmtHHMM(o.time, tz).slice(0, 2)}:00`;
    if (h !== lastHour) {
      items.push({ hour: h });
      lastHour = h;
    }
    items.push({ occ: o });
  }

  return (
    <div className="schedule-view" data-testid="schedule-view">
      <div className="sv-main">
        <div className="sv-bar">
          {plan.days.length > 1 ? (
            <div className="tabs" role="tablist" aria-label="Day">
              {plan.days.map((d) => (
                <button key={d.id} type="button" role="tab" aria-selected={tab === d.id} className="tab" data-testid={`tab-${d.id}`} onClick={() => setTab(d.id)}>
                  {d.label}
                </button>
              ))}
            </div>
          ) : (
            <h2 className="sv-day">{dayLabel(plan, tab)}</h2>
          )}
          <Seg<'day' | '3h'>
            className="gantt-zoom"
            label="Chart range"
            value={zoom ? '3h' : 'day'}
            onChange={(v) => setZoom(v === '3h')}
            options={[
              { value: 'day', label: 'Whole day', testId: 'zoom-day' },
              { value: '3h', label: nowOnTab ? '3 h around now' : 'Busiest 3 h', testId: 'zoom-3h' },
            ]}
          />
          <Btn className="sv-recipes-btn" onClick={() => setPanelOpen(true)}>
            Recipes
          </Btn>
        </div>
        <Gantt api={api} day={tab} occs={occs} sel={sel.occId} onSelect={select} zoom={zoom} />
        <ol className="sched-list" data-testid="timeline" ref={listRef}>
          {items.map((it, i) => {
            if (it.hour)
              return (
                <li key={`h${i}`} className="sl-hour">
                  {it.hour}
                </li>
              );
            const o = it.occ!;
            const status = api.statusOf(o.occId);
            const eq = chipsFor(plan, o.task)
              .map((c) => c.label)
              .join('  ·  ');
            return (
              <li key={o.occId} data-occ={o.occId} className="sl-li">
                <button
                  type="button"
                  className={`sl-row${currentId === o.occId ? ' tl-current' : ''}${sel.occId === o.occId ? ' sl-sel' : ''}${o.task.critical ? ' tl-crit' : ''}`}
                  data-testid={`timeline-row-${o.occId}`}
                  data-status={status}
                  onClick={() => select(o.occId)}
                >
                  <span className="tl-node" aria-hidden="true" />
                  <span className="sl-time">
                    {fmtHHMM(o.time, tz)}
                    {o.shiftMin !== 0 && <s>{fmtHHMM(o.baseTime, tz)}</s>}
                  </span>
                  <span className="sl-main">
                    <span className="sl-title">{o.task.title}</span>
                    {o.task.details && <span className="sl-prev">{previewOf(o.task.details)}</span>}
                    {eq && <span className="sl-eq">{eq}</span>}
                  </span>
                  <span className="tl-status">{statusIcon(status, api.day.occ[o.occId]?.snoozedUntil, tz)}</span>
                </button>
              </li>
            );
          })}
          {occs.length === 0 && <li className="tl-empty muted">Nothing planned for this day.</li>}
        </ol>
      </div>
      <aside className={`rp-dock${panelOpen ? ' rp-open' : ''}`} data-testid="recipe-panel" aria-label="Recipes">
        <div className="rp-head">
          <h2>{sel.occId ? 'Task & recipe' : 'Recipes'}</h2>
          <Btn className="rp-close" onClick={() => setPanelOpen(false)}>
            Close
          </Btn>
        </div>
        <div className="rp-scroll">
          <RecipePanelBody api={api} occId={sel.occId} recipeId={sel.recipeId} onChange={setSel} />
        </div>
      </aside>
    </div>
  );
}
