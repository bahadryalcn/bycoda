import type { HostTask } from "../../src/features/tasks/model/hostTasks";
import type { HostAutomationRun } from "../../src/features/automations/model/hostAutomations";
import {
  recipeCursor,
  type Recipe,
  type RecipeInstance,
  type RecipeInstanceConfig,
  type RecipeStop,
} from "../../src/features/automations/model/automationRecipe";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";
import { projectTask } from "../../src/shared/model/workProjection";
import type { HostStore } from "../store";
import type { HostTasks } from "../tasks/service";
import { createWork } from "../tasks/work-request";

/**
 * A recipe occurrence is an ordinary automation run whose body is `run.recipe`: the version it
 * started on, a copy of its settings and one result per step. Each step result is saved in the
 * same transaction that creates the step's task, so a step is never created twice, and a step
 * that already has a result is never started again, whatever the Host did since.
 */

export type RecipeAdvance = {
  run: HostAutomationRun;
  /** Set once the occurrence reached a terminal state; the caller finishes the run. */
  done?: { status: "succeeded" | "failed" | "cancelled"; error?: string };
};

/** The instance a new occurrence starts with: the recipe as it is now, with no results yet. */
export function startRecipeInstance(recipe: Recipe, config: RecipeInstanceConfig): RecipeInstance {
  return {
    version: recipe.version,
    steps: structuredClone(recipe.steps),
    config: structuredClone(config),
    results: [],
  };
}

export const recipeTaskId = (runId: string, index: number) => `recipe-${runId}-${index}`;

/** One sentence the owner can read in the instance view; the task stays the full record. */
function taskSummary(task: HostTask): string {
  const attempt = task.attemptHistory?.at(-1)?.workerSummary?.trim();
  return truncateGraphemes(attempt || task.title, 300);
}

function stopped(
  run: HostAutomationRun,
  instance: RecipeInstance,
  results: RecipeInstance["results"],
  stop: RecipeStop,
  status: "failed" | "cancelled",
): RecipeAdvance {
  return {
    run: { ...run, needsInput: undefined, recipe: { ...instance, results, stop } },
    done: { status, error: stop.message },
  };
}

/**
 * Moves an occurrence as far as it can go without waiting: finished steps are recorded, the next
 * step's task is created, a decision step pauses. Call it inside a store transaction on the run's
 * current row; it only reads the task of the step that already has a result.
 */
export async function advanceRecipe(
  deps: { store: HostStore; tasks: HostTasks },
  run: HostAutomationRun,
  now: number,
): Promise<RecipeAdvance> {
  const instance = run.recipe;
  if (!instance || instance.stop) return { run };
  const results = [...instance.results];
  const withResults = (needsInput?: boolean): HostAutomationRun => ({
    ...run,
    needsInput,
    recipe: { ...instance, results },
  });
  for (;;) {
    const index = recipeCursor({ steps: instance.steps, results });
    if (index >= instance.steps.length)
      return { run: withResults(), done: { status: "succeeded" } };
    const step = instance.steps[index]!;
    const last = results[index];
    if (!last) {
      if (step.kind === "decision") {
        results.push({ stepId: step.id, status: "awaiting", at: now });
        return { run: withResults(true) };
      }
      const config = instance.config;
      const id = recipeTaskId(run.id, index);
      await createWork(
        deps,
        {
          id,
          projectId: config.projectId,
          request: step.request,
          title: step.title,
          source: { kind: "automation", automationRunId: run.id },
          executor: step.executor ?? config.executor,
          helpers: step.helpers ?? config.helpers,
          execution: {
            modelChoice: step.modelChoice ?? config.modelChoice ?? { kind: "default" },
            harness: config.harness,
            providerAccountId: config.providerAccountId,
            model: config.model,
            modelSettings: config.modelSettings,
            runtimeMode: config.runtimeMode,
          },
          options: {
            source: "automation",
            automationId: run.automationId,
            maxRunMinutes: config.maxRunMinutes,
            isolate: config.isolate,
            review: false,
            status: "queued",
          },
        },
        { requestId: `${run.id}:${index}` },
      );
      results.push({ stepId: step.id, status: "running", taskId: id, at: now });
      return { run: withResults() };
    }
    if (last.status === "awaiting") return { run: withResults(true) };
    const task = last.taskId ? await deps.tasks.get(last.taskId) : undefined;
    if (!task || task.automationRunId !== run.id) {
      // The step was started and its task cannot be read: the outcome is unknown, so nothing is repeated.
      results[index] = { ...last, status: "failed", at: now };
      return stopped(
        run,
        instance,
        results,
        {
          code: "step_uncertain",
          stepIndex: index,
          message: step.title,
          nextAction: "run_again",
        },
        "failed",
      );
    }
    const projection = projectTask(task);
    if (projection.phase === "done") {
      results[index] = { ...last, status: "succeeded", summary: taskSummary(task), at: now };
      continue;
    }
    if (projection.phase === "stopped" || projection.phase === "cancelled") {
      const owner = projection.phase === "cancelled";
      results[index] = { ...last, status: owner ? "cancelled" : "failed", at: now };
      return stopped(
        run,
        instance,
        results,
        {
          code: owner ? "owner_stopped" : "step_stopped",
          stepIndex: index,
          message: truncateGraphemes(projection.stop?.reason || task.error || step.title, 1000),
          nextAction: owner ? "run_again" : "open_task",
        },
        owner ? "cancelled" : "failed",
      );
    }
    return { run: withResults(projection.phase === "input") };
  }
}

/**
 * The owner's answer to the decision the instance waits on. Approval records the step and the
 * caller advances; declining stops the instance with a structured reason.
 */
export function decideRecipe(run: HostAutomationRun, approve: boolean, now: number): RecipeAdvance {
  const instance = run.recipe;
  const index = instance ? recipeCursor(instance) : -1;
  const last = instance?.results[index];
  if (!instance || instance.stop || last?.status !== "awaiting")
    throw new Error("This run is not waiting for a decision.");
  const results = [...instance.results];
  if (approve) {
    results[index] = { ...last, status: "succeeded", at: now };
    return { run: { ...run, needsInput: undefined, recipe: { ...instance, results } } };
  }
  results[index] = { ...last, status: "declined", at: now };
  return stopped(
    run,
    instance,
    results,
    {
      code: "decision_declined",
      stepIndex: index,
      message: instance.steps[index]?.title,
      nextAction: "run_again",
    },
    "cancelled",
  );
}
