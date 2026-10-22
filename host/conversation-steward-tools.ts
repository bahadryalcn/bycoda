import type { HostStore } from "./store";
import type { HostStewards } from "./stewards";
import type { RuntimeLogPrincipal } from "./runtime-log-tools";
import type { Session } from "../src/features/sessions/model/session";
import { scrubRuntimeLogText } from "./runtime-logs";
import type { StewardRun } from "../src/features/tasks/model/hostStewards";

const text = { type: "string", minLength: 1, maxLength: 300 };
const schedule = {
  scheduleKind: { enum: ["hourly", "daily", "weekdays", "weekly"] },
  minute: { type: "integer", minimum: 0, maximum: 59 },
  time: { type: "string", minLength: 5, maxLength: 5 },
  dayOfWeek: { type: "integer", minimum: 0, maximum: 6 },
  focus: { type: "string", maxLength: 4000 },
  maxProposals: { type: "integer", minimum: 1, maximum: 10 },
  maxOpen: { type: "integer", minimum: 1, maximum: 30 },
};
const target = { stewardId: text, expectedUpdatedAt: { type: "integer", minimum: 0 } };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const STEWARD_CONVERSATION_TOOLS = {
  "stewards.create": object({ stewardId: text, ...schedule, enabled: { type: "boolean" } }, [
    "stewardId",
    "scheduleKind",
  ]),
  "stewards.update": object({ ...target, ...schedule }, ["stewardId", "expectedUpdatedAt"]),
  "stewards.pause": object(target, ["stewardId", "expectedUpdatedAt"]),
  "stewards.resume": object(target, ["stewardId", "expectedUpdatedAt"]),
  "stewards.runNow": object(target, ["stewardId", "expectedUpdatedAt"]),
  "stewards.stopRun": object({ ...target, runId: text }, [
    "stewardId",
    "expectedUpdatedAt",
    "runId",
  ]),
} as const;
export type StewardConversationTool = keyof typeof STEWARD_CONVERSATION_TOOLS;
export const isStewardConversationTool = (action: string): action is StewardConversationTool =>
  Object.hasOwn(STEWARD_CONVERSATION_TOOLS, action);
export const describeStewardConversationTool = (action: string) =>
  isStewardConversationTool(action)
    ? "Manage this project's scheduled steward with revision checks. Creation inherits this session's provider/model/permission mode and never auto-starts or auto-merges proposed tasks. Updates only schedule/focus/proposal limits. Owner configurations with autoStart/autoMerge or a different permission mode can only be paused/stopped here. A steward agent cannot manage its own steward. Pause stops future schedules; stopRun requests cancellation of the exact active turn; poll stewards.get for settlement."
    : undefined;
const runReceipt = (run: StewardRun | undefined) =>
  run
    ? {
        sessionId: run.sessionId,
        runId: run.runId,
        startedAt: run.startedAt,
      }
    : undefined;

/** Reuses the host scheduler; no generic settings writes or review evidence edits. */
export class ConversationStewardTools {
  constructor(
    private readonly store: Pick<HostStore, "project" | "transaction">,
    private readonly stewards: Pick<HostStewards, "list" | "save" | "runNow" | "stopRun">,
  ) {}

  async call(
    action: StewardConversationTool,
    input: Record<string, unknown>,
    principal: RuntimeLogPrincipal,
    session: Session,
    authorized: () => boolean,
  ): Promise<unknown> {
    if (!authorized()) throw new Error("Session authority revoked.");
    if (!isStewardConversationTool(action))
      throw new Error("Unsupported steward conversation tool.");
    const schema = STEWARD_CONVERSATION_TOOLS[action];
    if (Object.keys(input).some((key) => !Object.hasOwn(schema.properties, key)))
      throw new Error("Unknown or protected steward field.");
    this.store.project(principal.projectId);
    const id = String(input.stewardId);
    const current = () => {
      const existing = this.stewards.list().find((entry) => entry.id === id);
      if (!existing || existing.projectId !== principal.projectId)
        throw new Error("Steward not found in this project scope.");
      if (existing.updatedAt !== input.expectedUpdatedAt)
        throw new Error("Steward changed. Read it before updating.");
      if (
        existing.run?.sessionId === principal.sessionId ||
        existing.lastSessionId === principal.sessionId
      )
        throw new Error("A steward agent cannot manage its own steward.");
      return existing;
    };
    if (action === "stewards.create")
      return this.store.transaction(() => {
        if (this.stewards.list().some((entry) => entry.id === id))
          throw new Error("Steward ID already exists. Read it before retrying creation.");
        const saved = this.stewards.save({
          ...input,
          id,
          projectId: principal.projectId,
          harness: session.harness,
          model: session.model,
          modelSettings: session.modelSettings,
          runtimeMode: session.runtimeMode,
          autoStart: false,
          autoMerge: false,
          minute: input.minute ?? 0,
          time: input.time ?? "09:00",
          dayOfWeek: input.dayOfWeek ?? 1,
        });
        return {
          stewardId: saved.id,
          enabled: saved.enabled,
          updatedAt: saved.updatedAt,
          nextRunAt: saved.nextRunAt,
        };
      });
    const existing = current();
    if (
      action !== "stewards.pause" &&
      action !== "stewards.stopRun" &&
      (existing.autoMerge || existing.autoStart || existing.runtimeMode !== session.runtimeMode)
    )
      throw new Error("This steward's execution settings require owner management.");
    if (action === "stewards.runNow") {
      if (existing.run)
        return { requested: false, reason: "already-running", run: runReceipt(existing.run) };
      const result = await this.stewards.runNow(id);
      if (!authorized())
        throw new Error("Session authority revoked. Read steward state before retrying.");
      return {
        requested: !!result.run,
        stewardId: id,
        run: runReceipt(result.run),
        lastRunStatus: result.lastRunStatus,
        ...(result.lastRunError
          ? { lastRunError: scrubRuntimeLogText(result.lastRunError, 2000) }
          : {}),
      };
    }
    if (action === "stewards.stopRun") {
      const result = this.stewards.stopRun(id, String(input.runId));
      return { requested: result.requested, run: runReceipt(result.run) };
    }
    return this.store.transaction(() => {
      const latest = current();
      if (action === "stewards.pause" || action === "stewards.resume") {
        const saved = this.stewards.save({
          ...latest,
          enabled: action === "stewards.resume",
          expectedConfiguration: latest,
        });
        return {
          stewardId: saved.id,
          enabled: saved.enabled,
          updatedAt: saved.updatedAt,
          nextRunAt: saved.nextRunAt,
        };
      }
      const { stewardId: _id, expectedUpdatedAt: _version, ...patch } = input;
      if (!Object.keys(patch).length) throw new Error("Supply steward fields to update.");
      const saved = this.stewards.save({
        ...latest,
        ...patch,
        id,
        projectId: principal.projectId,
        expectedConfiguration: latest,
      });
      return {
        stewardId: saved.id,
        enabled: saved.enabled,
        updatedAt: saved.updatedAt,
        nextRunAt: saved.nextRunAt,
      };
    });
  }
}
