import type { CookAlongApi } from '../app/api';
import type { RecipeLine } from '../data/types';
import { equipLine, fmtHHMM } from './format';
import { renderBold } from './text';
import { Btn, CheckRow, Icon } from './shared';

function Lines({ lines, recipeId, kind, api }: { lines: RecipeLine[]; recipeId: string; kind: 'ing' | 'step'; api: CookAlongApi }) {
  let n = 0;
  return (
    <ul className="check-list">
      {lines.map((ln, i) => {
        if (typeof ln !== 'string')
          return (
            <li key={i} className="check-heading">
              {ln.heading}
            </li>
          );
        n += 1;
        const key = `${recipeId}:${kind}:${i}`;
        return (
          <li key={i}>
            <CheckRow checked={!!api.prefs.checks[key]} onChange={() => api.toggleCheck(key)} testId={`check-${key}`}>
              {kind === 'step' && <span className="step-n">{n}</span>}
              {renderBold(ln)}
            </CheckRow>
          </li>
        );
      })}
    </ul>
  );
}

export function RecipeCard({ api, recipeId }: { api: CookAlongApi; recipeId: string }) {
  const r = api.plan.recipes.find((x) => x.id === recipeId);
  if (!r) return <p className="muted">Recipe not found.</p>;
  return (
    <div className="recipe-card" data-testid="recipe-card">
      <h3 className="recipe-name">{r.name}</h3>
      {(r.yield || r.when) && (
        <dl className="recipe-facts">
          {r.yield && (
            <div>
              <dt>Makes</dt>
              <dd>{r.yield}</dd>
            </div>
          )}
          {r.when && (
            <div>
              <dt>When</dt>
              <dd>{r.when}</dd>
            </div>
          )}
        </dl>
      )}
      <h4>Ingredients</h4>
      <Lines lines={r.ingredients} recipeId={r.id} kind="ing" api={api} />
      <h4>Steps</h4>
      <Lines lines={r.steps} recipeId={r.id} kind="step" api={api} />
      {r.notes && r.notes.length > 0 && (
        <>
          <h4>Notes</h4>
          <ul className="notes">
            {r.notes.map((n, i) => (
              <li key={i}>{renderBold(n)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Recipes side panel body. Controlled: `occId` = selected task (shows its details +
 * its recipes as tabs), `recipeId` = shown/pinned recipe. Neither = recipe list.
 */
export function RecipePanelBody({
  api,
  occId,
  recipeId,
  onChange,
}: {
  api: CookAlongApi;
  occId?: string;
  recipeId?: string;
  onChange: (next: { occId?: string; recipeId?: string }) => void;
}) {
  const { plan } = api;
  const occ = occId ? api.occurrences.find((o) => o.occId === occId) : undefined;
  const taskRecipes = (occ?.task.recipeIds ?? []).filter((id) => plan.recipes.some((r) => r.id === id));
  const shown = recipeId ?? (occ ? taskRecipes[0] : undefined);
  const eq = occ ? equipLine(plan, occ.task) : null;

  return (
    <div className="rp-body">
      {occ && (
        <section className="rp-task" data-testid="rp-task">
          <div className="rp-task-head">
            <span className="rp-time">{fmtHHMM(occ.time, plan.timeZone)}</span>
            {eq && <span className="eq-line">{eq}</span>}
          </div>
          <strong className="rp-title">{occ.task.title}</strong>
          {occ.task.details && <p className="rp-details">{renderBold(occ.task.details)}</p>}
          {api.statusOf(occ.occId) === 'done' ? (
            <Btn data-testid="rp-undone" onClick={() => api.undone(occ.occId)}>
              Undo done
            </Btn>
          ) : (
            <Btn className="btn-primary" data-testid="rp-done" onClick={() => api.done(occ.occId)}>
              Mark done
            </Btn>
          )}
        </section>
      )}
      {taskRecipes.length > 1 && (
        <div className="rp-tabs" role="tablist">
          {taskRecipes.map((id) => (
            <button key={id} type="button" role="tab" aria-selected={shown === id} className="rp-tab" onClick={() => onChange({ occId, recipeId: id })}>
              {plan.recipes.find((r) => r.id === id)?.name}
            </button>
          ))}
        </div>
      )}
      {shown ? (
        <>
          <Btn className="btn-ghost rp-back" onClick={() => onChange({})}>
            <Icon name="back" /> All recipes
          </Btn>
          <RecipeCard api={api} recipeId={shown} />
        </>
      ) : (
        <>
          {occ && !taskRecipes.length && <p className="muted">No recipe for this task.</p>}
          {plan.recipes.length === 0 && <p className="muted">This plan has no recipes.</p>}
          <div className="recipe-list">
            {plan.recipes.map((x) => (
              <button key={x.id} type="button" className="recipe-link" data-testid={`recipe-${x.id}`} onClick={() => onChange({ occId, recipeId: x.id })}>
                <strong className="rl-name">{x.name}</strong>
                {x.when && <span className="rl-when">{x.when}</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
