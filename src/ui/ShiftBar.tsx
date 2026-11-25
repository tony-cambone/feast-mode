import { useState } from 'react';
import type { CookAlongApi } from '../app/api';
import type { Equipment } from '../data/types';
import { deviceName } from './format';
import { Btn } from './shared';
import type { Nav } from './shared';
import { Drawer } from './Drawers';

const MINUTES = [5, 10, 15, 30];

/** The one always-visible control: +15 everything, plus More… */
export function ShiftBar({ nav }: { nav: Nav }) {
  return (
    <div className="shiftbar">
      <Btn className="btn-late-all" data-testid="shift-all-15" onClick={() => nav.shift(15, { kind: 'all' }, 'All')}>
        <span className="late-q">Running late?</span>
        <span className="late-a">+15 min everything</span>
      </Btn>
      <Btn data-testid="shift-more" onClick={() => nav.open({ kind: 'shift' })}>
        More…
      </Btn>
    </div>
  );
}

export function ShiftSheet({ api, nav, z, onClose }: { api: CookAlongApi; nav: Nav; z: number; onClose: () => void }) {
  const [lane, setLane] = useState<'all' | Equipment>('all');
  const lanes = api.plan.devices.map((d) => d.id);
  const laneName = (l: 'all' | Equipment) => (l === 'all' ? 'Everything' : deviceName(api.plan, l, true));
  const log = api.day.shiftLog;
  const last = log[log.length - 1];
  const label = lane === 'all' ? 'All' : laneName(lane);
  return (
    <Drawer title="Running late" z={z} onClose={onClose} testId="shift-sheet" sheet>
      <p className="muted">Pick what is behind, then how far to push every remaining task today.</p>
      <div className="shift-row" role="group" aria-label="Lane">
        {(['all', ...lanes] as const).map((l) => (
          <button key={l} type="button" className="lane-chip" aria-pressed={lane === l} data-testid={`lane-${l}`} onClick={() => setLane(l)}>
            {laneName(l)}
          </button>
        ))}
      </div>
      <div className="shift-row shift-amounts">
        {MINUTES.map((m) => (
          <Btn
            key={m}
            className="btn-shift"
            data-testid={lane === 'all' && m === 15 ? 'shift-all-15-sheet' : `shift-${lane}-${m}`}
            onClick={() => nav.shift(m, lane === 'all' ? { kind: 'all' } : { kind: 'lane', lane }, label)}
          >
            +{m}
          </Btn>
        ))}
      </div>
      <div className="shift-row">
        <Btn data-testid="undo-shift" disabled={log.length === 0} onClick={() => api.undoShift()}>
          {last ? `Undo: ${last.label}` : 'Undo last shift'}
        </Btn>
        <Btn
          data-testid="reset-shifts"
          disabled={log.length === 0}
          onClick={() => nav.confirm('Reset all running-late shifts back to the original schedule?', 'Reset shifts', () => api.resetShifts())}
        >
          Reset shifts
        </Btn>
      </div>
    </Drawer>
  );
}
