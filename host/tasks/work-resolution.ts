import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type {
  ModelRoutingResolution,
  ModelRoutingRole,
} from "../../src/shared/model/host-contracts/model-routing";
import type {
  ResolvedExecutor,
  WorkResolved,
} from "../../src/shared/model/host-contracts/work-executor";
import { applyHelpers, resolveHelpers, withoutHelperSettings } from "../model-routing/helpers";
import { hostModelRoutingService } from "../model-routing/runtime";
import type { HostStore } from "../store";
import { modelTarget } from "./model-routing";

/** The Settings > Models role that picks a task's model, by where the work came from. */
export function workRole(
  task: Pick<HostTask, "source" | "origin" | "crewRunId">,
): ModelRoutingRole {
  if (task.crewRunId) return "crew.member";
  return task.source === "automation" || task.origin?.kind === "automation"
    ? "automation"
    : "task.worker";
}

type Chosen = { executor: ResolvedExecutor; reason?: string };

/**
 * What a single agent will run with, and the record of how that was chosen. Settings are read
 * once here; a session already running never changes model or helpers when Settings change.
 */
export async function workerResolution(
  store: HostStore,
  task: HostTask,
  resolution: ModelRoutingResolution,
  chosen: Chosen,
  now: number,
): Promise<{ modelSettings: Record<string, string>; resolved: WorkResolved }> {
  const target = resolution.ok ? resolution.target : modelTarget(task);
  const applied = await applyHelpers(store, target, task.helpers);
  const reason = chosen.reason ?? task.resolved?.reason;
  return {
    modelSettings: applied.modelSettings,
    resolved: {
      executor: chosen.executor,
      target: {
        harness: target.harness,
        ...(target.providerAccountId ? { providerAccountId: target.providerAccountId } : {}),
        model: target.model,
        modelSettings: withoutHelperSettings(target.modelSettings),
      },
      routingSource: resolution.ok ? resolution.source : { kind: "stored" },
      role: workRole(task),
      skipped: resolution.skipped,
      helpers: applied.helpers,
      ...(reason ? { reason } : {}),
      at: now,
    },
  };
}

/** A crew picks its own members' models, so only the helper policy and the choice are recorded. */
export async function crewResolution(
  store: HostStore,
  task: HostTask,
  chosen: Chosen,
  now: number,
): Promise<WorkResolved> {
  const { delegation } = await hostModelRoutingService(store).get();
  // No provider is known yet, so only the global layer of Settings applies to the summary.
  const { resolved: helpers } = resolveHelpers({
    delegation,
    target: { harness: "" },
    helpers: task.helpers,
  });
  return {
    executor: chosen.executor,
    routingSource: { kind: "crew" },
    skipped: [],
    helpers,
    reason: chosen.reason ?? "The crew picks its members' models.",
    at: now,
  };
}
