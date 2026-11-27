import type { HostTask } from "../../tasks/public/hostTasks";
import { truncateGraphemes } from "../../../shared/lib/text/truncate";
import type {
  Recipe,
  RecipeInstance,
  RecipeInstanceConfig,
} from "../../../shared/model/host-contracts/automations";

export type {
  Recipe,
  RecipeInstance,
  RecipeInstanceConfig,
  RecipeStep,
  RecipeStepResult,
  RecipeStop,
} from "../../../shared/model/host-contracts/automations";

/** The fields of an automation that become an instance's fixed settings. */
type RecipeSource = Omit<RecipeInstanceConfig, "maxRunMinutes" | "modelSettings"> & {
  modelSettings?: Record<string, string>;
  maxRunMinutes?: number;
};

/** What an instance copies from its automation when it starts. */
export function recipeConfigOf(source: RecipeSource): RecipeInstanceConfig {
  return {
    projectId: source.projectId,
    harness: source.harness,
    ...(source.providerAccountId ? { providerAccountId: source.providerAccountId } : {}),
    model: source.model,
    modelSettings: source.modelSettings ?? {},
    runtimeMode: source.runtimeMode,
    ...(source.modelChoice ? { modelChoice: source.modelChoice } : {}),
    ...(source.executor ? { executor: source.executor } : {}),
    ...(source.helpers ? { helpers: source.helpers } : {}),
    ...(source.isolate === undefined ? {} : { isolate: source.isolate }),
    maxRunMinutes: source.maxRunMinutes ?? 0,
  };
}

/** Editing a recipe's steps or defaults starts a new version; a save that changes neither keeps it. */
export function nextRecipeVersion(
  previous: { recipe?: Recipe; config: RecipeInstanceConfig } | undefined,
  next: { recipe: Recipe; config: RecipeInstanceConfig },
): number {
  if (!previous?.recipe) return 1;
  const same =
    JSON.stringify([previous.recipe.steps, previous.config]) ===
    JSON.stringify([next.recipe.steps, next.config]);
  return same ? previous.recipe.version : previous.recipe.version + 1;
}

export function newRecipeStepId(): string {
  return `step-${crypto.randomUUID().slice(0, 8)}`;
}

/** The recipe a finished task turns into: its request as the first step, its settings as the defaults. */
export function recipeFromTask(
  task: Pick<
    HostTask,
    | "title"
    | "request"
    | "prompt"
    | "projectId"
    | "harness"
    | "providerAccountId"
    | "model"
    | "modelSettings"
    | "runtimeMode"
    | "modelChoice"
    | "executor"
    | "helpers"
    | "isolate"
    | "maxRunMinutes"
  >,
): { name: string; recipe: Recipe; config: RecipeInstanceConfig } {
  return {
    name: truncateGraphemes(task.title.trim(), 200),
    recipe: {
      version: 1,
      steps: [
        {
          id: newRecipeStepId(),
          kind: "task",
          title: truncateGraphemes(task.title.trim() || "Task", 200),
          request: task.request?.trim() || task.prompt,
        },
      ],
    },
    config: recipeConfigOf({
      projectId: task.projectId,
      harness: task.harness,
      providerAccountId: task.providerAccountId,
      model: task.model,
      modelSettings: task.modelSettings,
      runtimeMode: task.runtimeMode,
      modelChoice: task.modelChoice,
      executor: task.executor && task.executor.kind !== "agent" ? task.executor : undefined,
      helpers: task.helpers,
      isolate: task.isolate,
      maxRunMinutes: task.maxRunMinutes,
    }),
  };
}

/** The step the instance is on, or undefined once every step has a result. */
export function recipeCursor(instance: Pick<RecipeInstance, "steps" | "results">): number {
  const last = instance.results[instance.results.length - 1];
  if (last && (last.status === "running" || last.status === "awaiting"))
    return instance.results.length - 1;
  return instance.results.length;
}
