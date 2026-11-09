import type { AgentModel } from "./models";

/**
 * Pure keyboard-row reconciliation for model lists (Quick selector, main
 * picker). The active row is owned by provider/model identity, never by an
 * index, so a catalog refresh that reorders, grows or shrinks the list cannot
 * move the user's highlight onto a different model.
 */
type ModelIdentity = Pick<AgentModel, "harness" | "id">;

/** Stable identity of one list row: the provider plus the model id. */
export function modelRowKey(model: ModelIdentity): string {
  return `${model.harness}\u0000${model.id}`;
}

type Eligibility = (model: AgentModel) => boolean;

const alwaysEligible: Eligibility = () => true;

/**
 * Row that should be highlighted. Policy, in order:
 * 1. the user's active identity, while it is still listed and eligible;
 * 2. the currently selected model, while it is listed and eligible;
 * 3. the first eligible row;
 * 4. null (nothing can be highlighted or chosen).
 */
export function resolveActiveModelKey(options: {
  models: readonly AgentModel[];
  activeKey: string | null;
  selected: ModelIdentity | null;
  isEligible?: Eligibility;
}): string | null {
  const { models, activeKey, selected, isEligible = alwaysEligible } = options;
  const eligible = models.filter(isEligible);
  if (activeKey != null && eligible.some((model) => modelRowKey(model) === activeKey)) {
    return activeKey;
  }
  if (selected) {
    const selectedKey = modelRowKey(selected);
    if (eligible.some((model) => modelRowKey(model) === selectedKey)) return selectedKey;
  }
  return eligible[0] ? modelRowKey(eligible[0]) : null;
}

/** Index of a key in the rendered list, or -1. */
export function modelKeyIndex(models: readonly AgentModel[], key: string | null): number {
  return key == null ? -1 : models.findIndex((model) => modelRowKey(model) === key);
}

/**
 * Next identity for an arrow key. Only eligible rows are visited (wrapping),
 * so an unavailable provider can never become the keyboard target.
 */
export function stepActiveModelKey(options: {
  models: readonly AgentModel[];
  activeKey: string | null;
  delta: 1 | -1;
  isEligible?: Eligibility;
}): string | null {
  const { models, activeKey, delta, isEligible = alwaysEligible } = options;
  const eligible = models.filter(isEligible);
  if (eligible.length === 0) return null;
  const current = eligible.findIndex((model) => modelRowKey(model) === activeKey);
  let next: number;
  if (current < 0) next = delta > 0 ? 0 : eligible.length - 1;
  else next = (current + delta + eligible.length) % eligible.length;
  return modelRowKey(eligible[next]);
}
