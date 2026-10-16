import { normalizeBudget, type UsageBudget } from "./usageBudgets";

const KEY = "bycoda.usageBudgets.v1";
const EVENT = "bycoda:usage-budgets";

export function loadUsageBudgets(): UsageBudget[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("Invalid usage budget settings");
  const result = parsed.map(normalizeBudget);
  if (result.some((b) => !b) || new Set(result.map((b) => b!.id)).size !== result.length)
    throw new Error("Invalid usage budget settings");
  return result as UsageBudget[];
}

/** Re-read before every mutation so unrelated edits in other windows survive. */
export function saveUsageBudget(budget: UsageBudget): void {
  const valid = normalizeBudget(budget);
  if (!valid) throw new Error("Invalid usage budget");
  const budgets = loadUsageBudgets();
  const index = budgets.findIndex((b) => b.id === budget.id);
  if (index < 0) budgets.push(valid);
  else budgets[index] = valid;
  localStorage.setItem(KEY, JSON.stringify(budgets));
  window.dispatchEvent(new Event(EVENT));
}

export function deleteUsageBudget(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(loadUsageBudgets().filter((b) => b.id !== id)));
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeUsageBudgets(listener: () => void): () => void {
  const storage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", storage);
  };
}
