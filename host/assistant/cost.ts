export { workerContextAction } from "../../src/shared/model/assistantContext";
export function chiefContextAction(
  used: number,
  window: number | undefined,
  soft = 150_000,
  hard = 250_000,
): "continue" | "compact" | "rotate" {
  if (used >= Math.min(hard, window ? window * 0.8 : hard)) return "rotate";
  return used >= soft ? "compact" : "continue";
}
export function tokenBudgetMode(total: number, budget: number): "run" | "report" | "paused" {
  return total >= budget ? "paused" : total >= budget * 0.8 ? "report" : "run";
}
