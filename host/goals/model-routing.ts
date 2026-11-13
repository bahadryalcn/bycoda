import type { HostStore } from "../store";
import { isFixedRouting, modelTarget, resolveRunModel } from "../tasks/model-routing";
import type { HostGoal } from "./goal-prompts";

/** Planner overrides stay fixed; routed goals use each run's own role. */
export async function resolveGoalRunModel(
  store: HostStore,
  goal: HostGoal,
  role: "goal.planner" | "goal.finalReview",
) {
  const explicit = role === "goal.planner" ? goal.plannerExecution : undefined;
  const input = explicit ?? goal;
  const resolution = await resolveRunModel(
    store,
    role,
    input,
    explicit || isFixedRouting(goal) ? { kind: "fixed" } : { kind: "default" },
  );
  return { resolution, target: resolution.ok ? resolution.target : modelTarget(input) };
}
