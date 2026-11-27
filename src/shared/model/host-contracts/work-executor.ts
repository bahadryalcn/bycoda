import { z } from "zod";
import { DelegateModelRefSchema, SUBAGENT_EFFORT_LEVELS } from "./delegation";
import { ModelRoutingSkipSchema, ModelRoutingTargetSchema } from "./model-routing";

/**
 * Who runs a piece of work. `auto` lets the Host pick at start: a crew when one fits, otherwise
 * one agent. The Host records what it picked in `resolved.executor`.
 */
export const WorkExecutorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("agent") }),
  z.strictObject({ kind: z.literal("crew"), crewDefinitionId: z.string().min(1).max(64) }),
  z.strictObject({ kind: z.literal("auto") }),
]);
export type WorkExecutor = z.infer<typeof WorkExecutorSchema>;
/** What a run really used; `auto` never appears here. */
export const ResolvedExecutorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("agent") }),
  z.strictObject({ kind: z.literal("crew"), crewDefinitionId: z.string().min(1).max(64) }),
]);
export type ResolvedExecutor = z.infer<typeof ResolvedExecutorSchema>;

export const DEFAULT_WORK_EXECUTOR: WorkExecutor = { kind: "agent" };

/**
 * Subagents and advisor for one piece of work. `settings` follows Settings > Models (task >
 * account > provider > global); `off` runs alone; `use` asks for helpers, optionally limited to
 * `models` and a `maxEffort` ceiling. A task choice never widens the settings' own model list
 * or effort ceiling.
 */
export const WorkHelpersSchema = z.strictObject({
  mode: z.enum(["settings", "off", "use"]),
  models: z.array(DelegateModelRefSchema).max(24).optional(),
  maxEffort: z.string().max(40).optional(),
  /** `null` turns the advisor off for this work. */
  advisor: DelegateModelRefSchema.nullable().optional(),
});
export type WorkHelpers = z.infer<typeof WorkHelpersSchema>;
export const DEFAULT_WORK_HELPERS: WorkHelpers = { mode: "settings" };

export const HELPERS_SOURCES = ["task", "account", "provider", "global", "default"] as const;
export const ResolvedHelpersSchema = z.strictObject({
  /** What the work asked for. */
  mode: z.enum(["settings", "off", "use"]),
  subagents: z.union([z.literal("auto"), z.literal("off"), z.array(DelegateModelRefSchema)]),
  maxEffort: z.string().max(40).optional(),
  advisor: DelegateModelRefSchema.optional(),
  /** The layer the subagent selection came from. */
  source: z.enum(HELPERS_SOURCES),
  /** The work asked for something Settings did not allow; Settings won. */
  limited: z.string().max(300).optional(),
  /** The work changed what Settings say (for example turned helpers on). */
  changesSettings: z.literal(true).optional(),
});
export type ResolvedHelpers = z.infer<typeof ResolvedHelpersSchema>;

/** The one record of how a run's executor, model and helpers were chosen; written at start. */
export const WorkResolvedSchema = z.strictObject({
  executor: ResolvedExecutorSchema,
  /** The model a single agent ran with; a crew picks its own members' models. */
  target: ModelRoutingTargetSchema.optional(),
  routingSource: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("fixed") }),
    z.strictObject({ kind: z.literal("order"), entryId: z.string() }),
    z.strictObject({ kind: z.literal("pool"), poolId: z.string(), entryId: z.string() }),
    /** Routing had nothing configured; the work's own stored model ran. */
    z.strictObject({ kind: z.literal("stored") }),
    z.strictObject({ kind: z.literal("crew") }),
  ]),
  /** The role Settings used for the model ("task.worker", "automation", ...). */
  role: z.string().max(64).optional(),
  skipped: z.array(ModelRoutingSkipSchema),
  helpers: ResolvedHelpersSchema,
  /** Why this executor, or why a requested one could not run. */
  reason: z.string().max(500).optional(),
  at: z.number().int().nonnegative(),
});
export type WorkResolved = z.infer<typeof WorkResolvedSchema>;

const CREW_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Validates an executor from the wire; absent stays absent. Throws with the reason. */
export function parseWorkExecutor(value: unknown): WorkExecutor | undefined {
  if (value === undefined) return undefined;
  const parsed = WorkExecutorSchema.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.kind === "crew" && !CREW_ID.test(parsed.data.crewDefinitionId))
  )
    throw new Error("Invalid executor");
  return parsed.data;
}

/** Validates a helper choice from the wire; absent stays absent. Throws with the reason. */
export function parseWorkHelpers(value: unknown): WorkHelpers | undefined {
  if (value === undefined) return undefined;
  const parsed = WorkHelpersSchema.safeParse(value);
  if (!parsed.success) throw new Error("Invalid helpers");
  return parsed.data;
}

/** The crew a task runs with, chosen directly or by `auto`; undefined for a single agent. */
export function workCrewId(work: {
  executor?: WorkExecutor;
  resolved?: Pick<WorkResolved, "executor">;
}): string | undefined {
  if (work.executor?.kind === "crew") return work.executor.crewDefinitionId;
  if (work.executor?.kind === "auto" && work.resolved?.executor.kind === "crew")
    return work.resolved.executor.crewDefinitionId;
  return undefined;
}

/**
 * Why a crew cannot run work with these options, or undefined. A crew works in the project's
 * shared checkout and reviews its own work, so these choices never reach it silently.
 * `field` names the control the owner has to change.
 */
export type WorkIncompatibility = { field: WorkIncompatibilityField; reason: string };
export type WorkIncompatibilityField =
  | "isolate"
  | "workspace"
  | "review"
  | "autoMerge"
  | "continueUntilDone"
  | "model";
export function crewIncompatibility(work: {
  isolate?: boolean;
  workspace?: unknown;
  review?: boolean;
  autoMerge?: boolean;
  continueUntilDone?: boolean;
  modelChoice?: { kind: string };
}): WorkIncompatibility | undefined {
  if (work.isolate === true)
    return {
      field: "isolate",
      reason: "A crew works in the shared project folder. Turn off isolation or choose Agent.",
    };
  if (work.workspace)
    return {
      field: "workspace",
      reason:
        "A crew works in the shared project folder. Clear the working branch or choose Agent.",
    };
  if (work.review === true)
    return {
      field: "review",
      reason: "A crew reviews its own work. Turn off the separate review or choose Agent.",
    };
  if (work.autoMerge === true)
    return { field: "autoMerge", reason: "A crew cannot merge on its own. Choose Agent." };
  if (work.continueUntilDone === true)
    return {
      field: "continueUntilDone",
      reason: "A crew cannot keep retrying on its own. Choose Agent.",
    };
  if (work.modelChoice && work.modelChoice.kind !== "default")
    return {
      field: "model",
      reason: "A crew picks its own members' models. Use settings or choose Agent.",
    };
  return undefined;
}

/** The lower of two subagent effort ceilings; an absent or unknown one imposes none. */
export function lowerEffortCeiling(a: string | undefined, b: string | undefined): string {
  const known = (value: string | undefined) =>
    value && SUBAGENT_EFFORT_LEVELS.includes(value) ? value : undefined;
  const first = known(a);
  const second = known(b);
  if (!first) return second ?? "";
  if (!second) return first;
  return SUBAGENT_EFFORT_LEVELS.indexOf(first) <= SUBAGENT_EFFORT_LEVELS.indexOf(second)
    ? first
    : second;
}
