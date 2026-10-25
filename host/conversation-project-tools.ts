import type { HostStore } from "./store";
import type { HostGoals } from "./goals";
import type { HostCheckpoints } from "./checkpoints";
import type { HostStewards } from "./stewards";
import type { HostAutomations } from "./automations";
import type { RuntimeLogPrincipal } from "./runtime-log-tools";
import { scrubRuntimeLogText } from "./runtime-logs";
import { readSessionUsage } from "./usage-report";
import {
  REMOTE_PROVIDERS,
  type HostModelCatalog,
  type RemoteProvider,
} from "../src/features/connections/model/protocol";

const text = { type: "string", minLength: 1, maxLength: 300 };
const pageFields = {
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100 },
};
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

export const PROJECT_CONVERSATION_TOOLS = {
  "automations.preview": object(
    {
      scheduleKind: { enum: ["hourly", "daily", "weekdays", "weekly"] },
      minute: { type: "integer", minimum: 0, maximum: 59 },
      time: { type: "string", minLength: 5, maxLength: 5 },
      dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
    },
    ["scheduleKind"],
  ),
  "stewards.list": object(pageFields),
  "stewards.get": object(
    {
      stewardId: text,
      offset: { type: "integer", minimum: 0 },
      maxChars: { type: "integer", minimum: 200, maximum: 20000 },
    },
    ["stewardId"],
  ),
  "usage.sessions.read": object(
    {
      sinceMs: { type: "integer", minimum: 0 },
      untilMs: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
      cursor: { type: "string", minLength: 1, maxLength: 256 },
    },
    ["sinceMs", "untilMs"],
  ),
  "goals.list": object(pageFields),
  "goals.get": object(
    {
      goalId: text,
      offset: { type: "integer", minimum: 0 },
      maxChars: { type: "integer", minimum: 200, maximum: 20000 },
    },
    ["goalId"],
  ),
  "checkpoints.status": object({ sessionId: text, ...pageFields }),
  "checkpoints.diff": object(
    {
      sessionId: text,
      relative: { type: "string", minLength: 1, maxLength: 2000 },
      offset: { type: "integer", minimum: 0 },
      maxChars: { type: "integer", minimum: 200, maximum: 20000 },
    },
    ["relative"],
  ),
  "providers.list": object({}),
  "models.list": object({ provider: { enum: REMOTE_PROVIDERS }, ...pageFields }),
} as const;
export type ProjectConversationTool = keyof typeof PROJECT_CONVERSATION_TOOLS;
export const PROJECT_READ_ACTIONS = Object.keys(
  PROJECT_CONVERSATION_TOOLS,
) as ProjectConversationTool[];
export const isProjectConversationTool = (action: string): action is ProjectConversationTool =>
  Object.hasOwn(PROJECT_CONVERSATION_TOOLS, action);

export function describeProjectConversationTool(action: string): string | undefined {
  if (action === "automations.preview")
    return "Preview the next run of a schedule using the host's existing scheduler and timezone. Defaults: minute=0, time=09:00, dayOfWeek=1. Read-only; does not save or launch an automation.";
  if (action.startsWith("stewards."))
    return "Read this project's scheduled steward and run state. List returns summaries; get returns paginated redacted JSON. Does not save, enable, run, decline proposals or enable automatic task/merge behavior.";
  if (action === "usage.sessions.read")
    return "Read this project's host-observed session usage for a UTC start-inclusive/end-exclusive window of at most 31 days. Cursor pagination and coverage gaps remain explicit. Page totals are not account quota, costs or billing totals; unknown fields remain null.";
  if (action.startsWith("goals."))
    return "Read goals wholly scoped to this project. List returns summaries; get returns paginated, redacted JSON text with plan and execution state. Multi-project goals require owner context and are excluded. This does not approve, start, replan, cancel or merge a goal.";
  if (action.startsWith("checkpoints."))
    return "Read session checkpoints in this project from the owning host or desktop store; defaults to the calling session. Status is paginated; diff returns bounded original/current text with independent truncation offsets. An unavailable desktop is an error, never an empty checkpoint. Read-only: undo and keep require owner action.";
  if (action === "models.list")
    return "Read this project's progressive cached host model catalog with pagination. Pending providers and discovery errors remain explicit; an incomplete catalog is not proof that a model is unavailable. No sign-in or settings changes.";
  if (action === "providers.list")
    return "List provider IDs configured in this host runtime. Configuration is not proof of authentication, account availability or model discovery; use models.list for progressive discovery.";
  return undefined;
}

function page<T>(items: T[], input: Record<string, unknown>) {
  const offset = Number(input.offset ?? 0),
    limit = Number(input.limit ?? 30);
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}

function jsonPage(value: unknown, input: Record<string, unknown>) {
  const content = JSON.stringify(value, (_key, item) =>
    typeof item === "string" ? scrubRuntimeLogText(item, Number.MAX_SAFE_INTEGER) : item,
  );
  const offset = Number(input.offset ?? 0),
    maxChars = Number(input.maxChars ?? 6000);
  return {
    format: "json",
    content: content.slice(offset, offset + maxChars),
    totalChars: content.length,
    offset,
    nextOffset: offset + maxChars < content.length ? offset + maxChars : null,
  };
}

/** Project identity always comes from the verified session grant, never input. */
export class ConversationProjectTools {
  constructor(
    private readonly store: Pick<
      HostStore,
      "project" | "session" | "usageMetadataPage" | "environmentId"
    >,
    private readonly goals: Pick<HostGoals, "list">,
    private readonly checkpoints: Pick<HostCheckpoints, "status" | "fileDiff">,
    private readonly providers: readonly RemoteProvider[],
    private readonly models: (projectId: string, progressive: boolean) => Promise<HostModelCatalog>,
    private readonly optional: {
      stewards?: Pick<HostStewards, "list">;
      automations?: Pick<HostAutomations, "preview">;
      session?: HostStore["session"];
      checkpoints?: (
        sessionId: string,
        principal: RuntimeLogPrincipal,
        authorized: () => boolean | Promise<boolean>,
      ) =>
        | Pick<HostCheckpoints, "status" | "fileDiff">
        | Promise<Pick<HostCheckpoints, "status" | "fileDiff">>;
    } = {},
  ) {}

  async call(
    action: ProjectConversationTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    authorized: () => boolean | Promise<boolean>,
  ): Promise<unknown> {
    const check = async () => {
      if (!(await authorized())) throw new Error("Session authority revoked.");
    };
    await check();
    await this.store.project(principal.projectId);
    if (action === "automations.preview") {
      if (!this.optional.automations) throw new Error("Automation previews unavailable.");
      return this.optional.automations.preview({
        minute: 0,
        time: "09:00",
        dayOfWeek: 1,
        ...input,
      });
    }
    if (action === "stewards.list" || action === "stewards.get") {
      if (!this.optional.stewards) throw new Error("Steward reads unavailable.");
      const visible = (await this.optional.stewards.list()).filter(
        (steward) => steward.projectId === principal.projectId,
      );
      if (action === "stewards.list")
        return page(
          visible.map((steward) => ({
            id: steward.id,
            enabled: steward.enabled,
            nextRunAt: steward.nextRunAt,
            lastRunAt: steward.lastRunAt,
            lastRunStatus: steward.lastRunStatus,
            running: !!steward.run,
            lastProposed: steward.lastProposed,
            createdAt: steward.createdAt,
            updatedAt: steward.updatedAt,
          })),
          input,
        );
      const steward = visible.find((steward) => steward.id === input.stewardId);
      if (!steward) throw new Error("Steward not found in this project scope.");
      return { stewardId: steward.id, ...jsonPage(steward, input) };
    }
    if (action === "usage.sessions.read")
      return await readSessionUsage(this.store as HostStore, {
        ...input,
        projectId: principal.projectId,
      });
    if (action === "providers.list") return { providers: [...this.providers] };
    if (action === "goals.list" || action === "goals.get") {
      const visible = (await this.goals.list()).filter(
        (goal) => goal.projectIds.length === 1 && goal.projectIds[0] === principal.projectId,
      );
      if (action === "goals.list")
        return page(
          visible.map((goal) => ({
            id: goal.id,
            title: scrubRuntimeLogText(goal.title ?? "", 200),
            status: goal.status,
            createdAt: goal.createdAt,
            updatedAt: goal.updatedAt,
            taskIds: goal.taskIds,
            plannerSessionId: goal.plannerSessionId,
            plannedTaskCount: goal.plan?.tasks.length ?? 0,
            hasError: !!(goal.error || goal.planError),
          })),
          input,
        );
      const goal = visible.find((goal) => goal.id === input.goalId);
      if (!goal) throw new Error("Goal not found in this project scope.");
      return { goalId: goal.id, ...jsonPage(goal, input) };
    }
    if (action === "models.list") {
      const catalog = await this.models(principal.projectId, true);
      await check();
      const providers = this.providers.filter(
        (provider) => input.provider === undefined || input.provider === provider,
      );
      const items = providers.flatMap((provider) =>
        (catalog.models[provider] ?? []).map((model) => ({ provider, model })),
      );
      return {
        ...page(items, input),
        errors: Object.fromEntries(
          providers
            .filter((provider) => catalog.errors[provider] !== undefined)
            .map((provider) => [provider, scrubRuntimeLogText(catalog.errors[provider]!, 2000)]),
        ),
        pending: (catalog.pending ?? []).filter((provider) => providers.includes(provider)),
      };
    }
    if (action !== "checkpoints.status" && action !== "checkpoints.diff")
      throw new Error("Unsupported project conversation tool.");
    const sessionId = String(input.sessionId ?? principal.sessionId);
    const session = await (this.optional.session ?? (async (id) => await this.store.session(id)))(
      sessionId,
    );
    if (session.projectId !== principal.projectId)
      throw new Error("Session not found in this project scope.");
    const checkpoints =
      (await this.optional.checkpoints?.(sessionId, principal, authorized)) ?? this.checkpoints;
    if (action === "checkpoints.status") {
      const status = await checkpoints.status(sessionId, session.session.cwd);
      await check();
      return { ...page(status.files, input), expectedCheckpoint: status.expectedCheckpoint };
    }
    const diff = await checkpoints.fileDiff(sessionId, session.session.cwd, String(input.relative));
    await check();
    const original = scrubRuntimeLogText(diff.original, Number.MAX_SAFE_INTEGER);
    const current = scrubRuntimeLogText(diff.current, Number.MAX_SAFE_INTEGER);
    const offset = Number(input.offset ?? 0),
      maxChars = Number(input.maxChars ?? 6000);
    return {
      ...diff,
      original: original.slice(offset, offset + maxChars),
      current: current.slice(offset, offset + maxChars),
      offset,
      originalLength: original.length,
      currentLength: current.length,
      originalNextOffset: offset + maxChars < original.length ? offset + maxChars : null,
      currentNextOffset: offset + maxChars < current.length ? offset + maxChars : null,
    };
  }
}
