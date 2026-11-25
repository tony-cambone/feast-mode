import { useEffect, useRef, useState } from 'react';
import type { PlanSourceApi } from '../app/api';
import { APP_NAME, TAGLINE } from './brand';
import { Drawer } from './Drawers';
import { Btn, Icon } from './shared';
import { DEFAULT_EMOJI } from './theme';

// The AI prompt lives in docs/MENU_PROMPT.md. A glob keeps the app building if the file is absent.
const promptFiles = import.meta.glob('../../docs/MENU_PROMPT.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PROMPT_DOC: string = Object.values(promptFiles)[0] ?? '';
/** The doc opens with a note for people reading the file; the prompt itself starts after the first rule. */
function promptText(): string {
  const cut = PROMPT_DOC.indexOf('\n---');
  const body = cut >= 0 ? PROMPT_DOC.slice(cut + 4) : PROMPT_DOC;
  return body.replace(/^\s+/, '');
}

type ImportResult = ReturnType<PlanSourceApi['importPlan']>;

/** 'tasks[3] (thu-1200).devices[0].device: "ovn" is not a device id' -> path + message. */
const PATH_RE = /^([A-Za-z_$][\w$-]*(?:\[\d+\])?(?: \([^)]*\))?(?:\.[A-Za-z_$][\w$-]*(?:\[\d+\])?(?: \([^)]*\))?)*): (.+)$/s;
function Issue({ text }: { text: string }) {
  const m = PATH_RE.exec(text);
  if (!m) return <li>{text}</li>;
  return (
    <li>
      <code className="issue-path">{m[1]}</code>
      <span>{m[2]}</span>
    </li>
  );
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Plans: what is cooking now, switch plan, and bring your own menu (copy prompt → AI → paste JSON). */
export function PlansDrawer({ ps, importPlan, z, onClose }: { ps: PlanSourceApi; importPlan: PlanSourceApi['importPlan']; z: number; onClose: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [removing, setRemoving] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const { plan } = ps;
  // The import result lands below the fold: bring it into view.
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: 'nearest' });
  }, [result]);
  const prompt = promptText();

  const submit = (t: string) => {
    const r = importPlan(t);
    setResult(r);
    if (r.ok) setText('');
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const t = await f.text();
      setText(t);
      submit(t);
    } catch {
      setResult({ ok: false, errors: [`Couldn't read ${f.name}.`], warnings: [] });
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const copy = async () => {
    setCopied((await copyText(prompt)) ? 'ok' : 'fail');
  };

  return (
    <Drawer title="Plans" z={z} onClose={onClose} testId="plans-drawer">
      <p className="plans-lede">
        <strong>{APP_NAME}.</strong> {TAGLINE}. Pick a plan below, or bring your own menu.
      </p>

      <section className="plan-active" data-testid="plan-active">
        <span className="plan-emoji plan-emoji-lg" aria-hidden="true">{plan.emoji || DEFAULT_EMOJI}</span>
        <div className="plan-active-text">
          <div className="eyebrow">Cooking now</div>
          <h3 className="plan-title">{plan.title}</h3>
          {plan.subtitle && <p className="muted">{plan.subtitle}</p>}
          <p className="plan-facts">
            {plan.days.map((d) => d.label).join('  →  ')}
            <br />
            {plan.tasks.length} steps · {plan.recipes.length} recipes · {plan.devices.map((d) => d.short ?? d.label).join(', ')}
          </p>
        </div>
        <Btn className="plan-download" data-testid="plan-download" onClick={() => download(`${plan.id}.json`, ps.exportActive())}>
          <Icon name="download" /> Download this plan
        </Btn>
      </section>

      {ps.available.length > 1 && (
        <section className="group">
          <h3>Switch plan</h3>
          <ul className="plan-list">
            {ps.available.map((p) => {
              const active = p.id === plan.id;
              return (
                <li key={p.id} className="plan-row">
                  <button type="button" className="plan-pick" aria-pressed={active} data-testid={`plan-pick-${p.id}`} onClick={() => !active && ps.activate(p.id)}>
                    <span className="plan-emoji" aria-hidden="true">{p.emoji || DEFAULT_EMOJI}</span>
                    <span className="plan-pick-text">
                      <strong>{p.title}</strong>
                      <span className="muted">{p.source === 'imported' ? 'Imported' : 'Built in'}</span>
                    </span>
                    {active && (
                      <span className="plan-on">
                        <Icon name="check" size={18} /> Cooking
                      </span>
                    )}
                  </button>
                  {p.source === 'imported' &&
                    (removing === p.id ? (
                      <>
                        <Btn
                          className="btn-danger"
                          data-testid={`plan-remove-yes-${p.id}`}
                          onClick={() => {
                            ps.removeImported(p.id);
                            setRemoving(null);
                          }}
                        >
                          Remove
                        </Btn>
                        <Btn onClick={() => setRemoving(null)}>Keep</Btn>
                      </>
                    ) : (
                      <Btn className="btn-ghost btn-icon" aria-label={`Remove ${p.title}`} data-testid={`plan-remove-${p.id}`} onClick={() => setRemoving(p.id)}>
                        <Icon name="trash" />
                      </Btn>
                    ))}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="group">
        <h3>Bring your own menu</h3>
        <ol className="steps">
          <li>
            <div>
              <strong>Copy the prompt.</strong> It tells an AI how to write a plan for this app.
              <div className="form-row">
                <Btn className={copied === 'ok' ? 'btn-on' : ''} data-testid="copy-ai-prompt" disabled={!prompt} onClick={() => void copy()}>
                  <Icon name={copied === 'ok' ? 'check' : 'copy'} /> {copied === 'ok' ? 'Copied' : 'Copy AI prompt'}
                </Btn>
              </div>
              {copied === 'fail' && (
                <div className="copy-fallback">
                  <p className="muted">Couldn't reach the clipboard. Select all of this and copy it:</p>
                  <textarea readOnly rows={5} value={prompt} onFocus={(e) => e.currentTarget.select()} />
                </div>
              )}
            </div>
          </li>
          <li>
            <div>
              <strong>Paste it into your AI</strong> (ChatGPT, Claude, any chat) with your menu, when you eat and the equipment you have.
            </div>
          </li>
          <li>
            <div>
              <strong>Paste the JSON it gives you here</strong>, or choose the file.
            </div>
          </li>
        </ol>
        <textarea
          className="plan-import"
          data-testid="plan-import-text"
          aria-label="Plan JSON"
          placeholder={'{\n  "id": "my-holiday-dinner",\n  "title": "…",\n  "days": [ … ]\n}'}
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (result && !result.ok) setResult(null);
          }}
        />
        <div className="form-row">
          <Btn className="btn-primary" data-testid="plan-import-submit" disabled={!text.trim()} onClick={() => submit(text)}>
            Import plan
          </Btn>
          <label className="btn file-btn">
            <Icon name="upload" /> Choose a .json file
            <input ref={fileRef} type="file" accept=".json,application/json" data-testid="plan-import-file" onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
        </div>

        <div className="import-results" ref={resultRef}>
          {result && !result.ok && (
            <div className="import-result import-bad" role="alert" data-testid="plan-import-errors">
              <strong>
                That plan can't be loaded yet. {result.errors.length} thing{result.errors.length === 1 ? '' : 's'} to fix:
              </strong>
              <ul className="issues">
                {result.errors.map((e, i) => (
                  <Issue key={i} text={e} />
                ))}
              </ul>
            </div>
          )}
          {result?.ok && (
            <div className="import-result import-ok" role="status" data-testid="plan-import-ok">
              <strong>
                <Icon name="check" /> {result.plan.emoji} {result.plan.title} is loaded and ready.
              </strong>
              <Btn className="btn-primary" onClick={onClose}>
                Start cooking
              </Btn>
            </div>
          )}
          {result && result.warnings.length > 0 && (
            <div className="import-result import-warn" data-testid="plan-import-warnings">
              <strong>
                {result.warnings.length} thing{result.warnings.length === 1 ? '' : 's'} worth a look:
              </strong>
              <ul className="issues">
                {result.warnings.map((w, i) => (
                  <Issue key={i} text={w} />
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </Drawer>
  );
}
