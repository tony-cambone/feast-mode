import type { ReactNode } from 'react';
import type { Plan, Task } from '../data/types';
import type { ShiftScope } from '../engine/types';
import { APP_NAME } from './brand';
import { chipsFor, deviceIcon } from './format';

export type DrawerDesc =
  | { kind: 'recipes'; recipeId?: string; occId?: string }
  | { kind: 'shift' }
  | { kind: 'problems'; focusId?: string }
  | { kind: 'temps' }
  | { kind: 'settings' }
  | { kind: 'task'; occId: string };

export interface Nav {
  open(d: DrawerDesc): void;
  openRecipe(id: string, occId?: string): void;
  openRecipesFor(occId: string): void;
  openFallback(id: string): void;
  openTask(occId: string): void;
  openPlans(): void;
  fullscreen(): void;
  confirm(message: string, yesLabel: string, onYes: () => void): void;
  shift(minutes: number, scope: ShiftScope, label: string): void;
}

/** Opens / closes the Plans drawer, which lives outside the per-plan app so it survives a plan switch. */
export interface PlansControl {
  isOpen: boolean;
  open(): void;
  close(): void;
}

/* ---------------- icons (inline, no library) ---------------- */
const ICONS = {
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M6 9l6 6 6-6" />,
  back: <path d="M15 6l-6 6 6 6" />,
  sliders: (
    <>
      <path d="M4 7h9M19 7h1M4 17h1M11 17h9" />
      <circle cx="16" cy="7" r="2.6" />
      <circle cx="8" cy="17" r="2.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2.5" />
      <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" />
    </>
  ),
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  upload: <path d="M12 20V9M7 13.5l5-5 5 5M5 4h14" />,
  trash: <path d="M5 7h14M10 7V4.5h4V7M7 7l1 12.5h8L17 7" />,
} as const;
export type IconName = keyof typeof ICONS;

export function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

/** The product wordmark: a small flame and the name, set in the display face. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      <svg className="wordmark-flame" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12.4 1.8c.5 3.6 5.1 5.6 5.1 11.1a5.5 5.5 0 0 1-11 0c0-2.3 1-3.9 2.3-5.1.1 1.9.9 3 1.9 3.4-.5-3.4.2-6.9 1.7-9.4z" />
      </svg>
      <span className="wordmark-name">{APP_NAME}</span>
    </span>
  );
}

export function Btn({
  children,
  className = '',
  ...rest
}: { children: ReactNode; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" className={`btn ${className}`} {...rest}>
      {children}
    </button>
  );
}

/** Segmented control: one choice from a short list. */
export function Seg<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className = '',
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode; testId?: string }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={`seg ${className}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" className="seg-b" aria-pressed={value === o.value} data-testid={o.testId} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A full-row checkbox (56px tall, the whole row is the target). */
export function CheckRow({
  checked,
  onChange,
  children,
  testId,
  inputTestId,
  plain,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
  testId?: string;
  inputTestId?: string;
  plain?: boolean;
}) {
  return (
    <label className={`check${checked ? ' check-on' : ''}${plain ? ' check-plain' : ''}`} data-testid={testId}>
      <input type="checkbox" checked={checked} data-testid={inputTestId} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">
        {checked && <Icon name="check" size={20} />}
      </span>
      <span className="check-text">{children}</span>
    </label>
  );
}

export function Chips({ plan, task, large }: { plan: Plan; task: Task; large?: boolean }) {
  const chips = chipsFor(plan, task);
  if (!chips.length) return null;
  return (
    <span className={`chips${large ? ' chips-lg' : ''}`}>
      {chips.map((c) => {
        const icon = deviceIcon(plan, c.device);
        return (
          <span key={c.key} className={`chip${c.isDevice ? ' chip-device' : ''}`} data-device={c.device}>
            {icon && <span aria-hidden="true">{icon}</span>}
            {c.label}
          </span>
        );
      })}
    </span>
  );
}
