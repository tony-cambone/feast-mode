import type { CSSProperties } from 'react';
import type { CookAlongApi } from '../app/api';
import { deviceIcon, deviceName, fmtHHMM, heatOf, isOff, itemTiming, nextOn, settingText } from './format';

/** Card density by device count, so 2 cards and 8 cards both fill the column sensibly. */
function densityFor(n: number): 'roomy' | 'regular' | 'dense' {
  if (n <= 3) return 'roomy';
  if (n <= 5) return 'regular';
  return 'dense';
}

/** Equipment board: one card per plan device, what is in it, at what setting, and what is next. */
export function Board({ api }: { api: CookAlongApi }) {
  const { plan } = api;
  const tz = plan.timeZone;
  return (
    <section className="board" data-density={densityFor(api.board.length)} data-count={api.board.length} aria-label="Equipment board">
      {api.board.map((d) => {
        const off = isOff(d.setting);
        const next = nextOn(plan, d);
        const icon = deviceIcon(plan, d.device);
        const style = { '--heat': off ? 0 : heatOf(plan, d.setting) } as CSSProperties;
        return (
          <article
            key={d.device}
            className={`dev ${off ? 'dev-off' : 'dev-on'}`}
            data-testid={`board-${d.device}`}
            data-setting={String(d.setting)}
            data-device={d.device}
            style={style}
          >
            <header className="dev-head">
              <h3 className="dev-name">
                {icon && <span className="dev-icon" aria-hidden="true">{icon}</span>}
                {deviceName(plan, d.device)}
              </h3>
              <div className="dev-setting">{settingText(plan, d.setting)}</div>
            </header>
            <div className="dev-body">
              {d.items.length > 0 ? (
                <ul className="dev-items">
                  {d.items.map((it) => {
                    const t = itemTiming(it, api.now, tz);
                    const span = it.until !== undefined ? it.until - it.since : 0;
                    const pct = span > 0 ? Math.min(100, Math.max(0, ((api.now - it.since) / span) * 100)) : undefined;
                    return (
                      <li key={it.id}>
                        <span className="dev-item-label">{it.label}</span>
                        <span className={`dev-item-time${t.over ? ' dev-item-over' : ''}`}>{t.text}</span>
                        {pct !== undefined && (
                          <span className="dev-item-bar" aria-hidden="true">
                            <i style={{ width: `${pct.toFixed(1)}%` }} />
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                !off && <p className="dev-empty">Empty{d.settingSince !== undefined ? ` · on since ${fmtHHMM(d.settingSince, tz)}` : ''}</p>
              )}
              {next && (
                <p className="dev-next">
                  <span className="dev-next-time">{next.time}</span>
                  <span className="dev-next-text">{next.text}</span>
                </p>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}
