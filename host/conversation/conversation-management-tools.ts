import { createHash } from "node:crypto";
import { CommandDispatchParamsSchema } from "../../src/shared/model/host-contracts/session-commands";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import {
  SESSION_MANAGEMENT_TOOLS,
  SESSION_MANAGEMENT_READS,
  describeSessionManagementTool,
} from "./conversation-session-management";
import {
  RUNTIME_MANAGEMENT_TOOLS,
  describeRuntimeManagementTool,
} from "./conversation-management-runtime";
import {
  PROJECT_MANAGEMENT_TOOLS,
  PROJECT_MANAGEMENT_READS,
} from "./conversation-project-management";
import {
  WORKSPACE_MANAGEMENT_TOOLS,
  WORKSPACE_MANAGEMENT_READS,
  describeWorkspaceManagementTool,
} from "./conversation-workspace-management";

const text = { type: "string", minLength: 1, maxLength: 300 };
const longText = { type: "string", minLength: 1, maxLength: 8000 };
const integer = { type: "integer", minimum: 0 };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const page = { offset: integer, limit: { type: "integer", minimum: 1, maximum: 100 } };
const write = { requestId: text };
const version = { ...write, expectedRevision: integer };
const workspace = { workspaceId: text };
const session = { sessionId: text };
const sprintFields = {
  name: text,
  goal: { type: "string", maxLength: 8000 },
  capacityPoints: { type: ["number", "null"], minimum: 0 },
  startsAt: integer,
  endsAt: integer,
};
/** Only these explicit operations are exposed. There is no arbitrary Host RPC proxy. */
export const MANAGEMENT_CONVERSATION_TOOLS = {
  ...SESSION_MANAGEMENT_TOOLS,
  ...RUNTIME_MANAGEMENT_TOOLS,
  ...PROJECT_MANAGEMENT_TOOLS,
  ...WORKSPACE_MANAGEMENT_TOOLS,
  "projects.get": object({}),
  "projects.workspacePolicy.get": object({}),
  "workspaces.list": object(page),
  "workspaces.get": object(workspace, ["workspaceId"]),
  "workspaces.featureClaims.list": object(page),
  "workspaces.resume": object({ ...workspace, ...version }, [
    "workspaceId",
    "requestId",
    "expectedRevision",
  ]),
  "workspaces.finish": object({ ...workspace, ...version }, [
    "workspaceId",
    "requestId",
    "expectedRevision",
  ]),
  "workspaces.close": object({ ...workspace, ...version }, [
    "workspaceId",
    "requestId",
    "expectedRevision",
  ]),
  "sprints.list": object(page),
  "sprints.get": object({ sprintId: text }, ["sprintId"]),
  "sprints.report": object({ sprintId: text }, ["sprintId"]),
  "sprints.create": object({ ...write, sprintId: text, ...sprintFields }, [
    "requestId",
    "sprintId",
    "name",
  ]),
  "sprints.update": object({ ...version, sprintId: text, ...sprintFields }, [
    "requestId",
    "sprintId",
    "expectedRevision",
  ]),
  "sprints.start": object({ ...version, sprintId: text }, [
    "requestId",
    "sprintId",
    "expectedRevision",
  ]),
  "sprints.complete": object({ ...version, sprintId: text }, [
    "requestId",
    "sprintId",
    "expectedRevision",
  ]),
  "sprints.archive": object({ ...version, sprintId: text }, [
    "requestId",
    "sprintId",
    "expectedRevision",
  ]),
  "sprints.plan": object(
    {
      ...version,
      sprintId: { type: ["string", "null"] },
      taskId: text,
      storyPoints: { type: ["number", "null"], minimum: 0 },
    },
    ["requestId", "sprintId", "taskId", "expectedRevision"],
  ),
  "git.status": object(page),
  "git.stage": object(
    {
      ...write,
      expectedStatus: text,
      paths: { type: "array", minItems: 1, maxItems: 100, items: longText },
    },
    ["requestId", "expectedStatus", "paths"],
  ),
  "git.unstage": object(
    {
      ...write,
      expectedStatus: text,
      paths: { type: "array", minItems: 1, maxItems: 100, items: longText },
    },
    ["requestId", "expectedStatus", "paths"],
  ),
  "git.commit": object({ ...write, expectedStatus: text, message: longText }, [
    "requestId",
    "expectedStatus",
    "message",
  ]),
  "preferences.read": object(page),
  "preferences.patch": object(
    {
      ...write,
      expectedRevision: text,
      change: {
        type: "object",
        description:
          "Application: {kind:theme,value:light|dark|system}, {kind:density,value:compact|comfortable|touch}, {kind:language,value:system|tr|en|de|fr|es|pt|zh-CN|ja}, {kind:voice,value:{visual,compact,manualTurnEnd,turnEndSilence,holdAnnouncements,allowBargeIn,idleSleepMinutes,natural,mode,engine,device}}. Existing provider defaults and prompt-template changes remain supported. No microphone enabling, credentials, paths or installation.",
      },
    },
    ["requestId", "expectedRevision", "change"],
  ),
  "preferences.status": object({ requestId: text }, ["requestId"]),
  "providers.status": object(page),
  "providers.quota.refresh": object(
    {
      ...write,
      expectedAccountRevision: text,
      provider: { enum: ["claude"] },
      accountId: text,
      confirm: { enum: ["REFRESH_PROVIDER_QUOTA"] },
    },
    ["requestId", "expectedAccountRevision", "provider", "accountId", "confirm"],
  ),
  "providers.operation.status": object({ requestId: text }, ["requestId"]),
  "commands.status": object({ ...session, commandId: text }, ["sessionId", "commandId"]),
  "commands.dispatch": object(
    {
      ...write,
      command: {
        type: "object",
        description:
          "Exact cancel, compact, answer, removeDraft or regenerateTitle command fields; no commandId, queued, authorityGeneration or attachments. Use dedicated sessions.configure and sessions.draft for configuration and accepted attachment drafts.",
      },
    },
    ["requestId", "command"],
  ),
  "ownerQuestions.list": object(page),
  "ownerQuestions.answer": object(
    { ...write, ...session, runId: text, questionRequestId: integer, answers: { type: "object" } },
    ["requestId", "sessionId", "runId", "questionRequestId", "answers"],
  ),
  "events.read": object({ ...page, after: integer }),
} as const;
export type ManagementAction = keyof typeof MANAGEMENT_CONVERSATION_TOOLS;
export const MANAGEMENT_READS = new Set<string>([
  ...SESSION_MANAGEMENT_READS,
  ...Object.keys(RUNTIME_MANAGEMENT_TOOLS),
  ...PROJECT_MANAGEMENT_READS,
  ...WORKSPACE_MANAGEMENT_READS,
  "projects.get",
  "projects.workspacePolicy.get",
  "workspaces.list",
  "workspaces.get",
  "workspaces.featureClaims.list",
  "sprints.list",
  "sprints.get",
  "sprints.report",
  "git.status",
  "preferences.read",
  "preferences.status",
  "providers.status",
  "providers.operation.status",
  "commands.status",
  "ownerQuestions.list",
  "events.read",
]);
export const isManagementAction = (action: string): action is ManagementAction =>
  Object.hasOwn(MANAGEMENT_CONVERSATION_TOOLS, action);
/** Never admit generic command fields that can claim queue, upload or execution authority. */
export function managementCommand(input: unknown, commandId: string) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid management command.");
  const command = input as Record<string, unknown>;
  if (
    !["cancel", "compact", "answer", "removeDraft", "regenerateTitle"].includes(
      String(command.type),
    )
  )
    throw new Error("This command requires its dedicated owner workflow.");
  if (["commandId", "queued", "authorityGeneration"].some((key) => Object.hasOwn(command, key)))
    throw new Error("Management commands cannot supply execution authority.");
  const reply = command.reply;
  if (reply && typeof reply === "object" && Object.hasOwn(reply, "attachments"))
    throw new Error("Management answers do not accept attachment references.");
  return CommandDispatchParamsSchema.parse({ ...command, commandId });
}
export function describeManagementTool(action: string) {
  if (action.startsWith("projects.organization."))
    return "Read or change focused desktop project names, groups, folders and ordering. Read projects.organization.read first and pass its expectedRevision with an exact change; patch requires native owner approval. Reuse requestId and inspect projects.organization.status. Private/locked projects and cross-window source gates remain enforced.";
  if (action.startsWith("preferences."))
    return "Read or change application theme, density, language, voice preferences, provider defaults and prompt templates through the connected desktop. An Assistant Room uses its real thread identity. Use preferences.read revision as expectedRevision; patch requires exact native owner approval and retained requestId. Never enables microphone capture, changes credentials or installs runtimes.";
  if (action.startsWith("providers."))
    return "Read desktop provider/account/quota metadata through the verified source; configuration is not authentication. Explicit Claude quota refresh requires accountRevision from providers.status, existing accountId and native owner approval. Poll providers.operation.status with the same requestId. Sign-in/credentials remain owner-only.";
  const session =
    describeSessionManagementTool(action) ??
    describeRuntimeManagementTool(action) ??
    describeWorkspaceManagementTool(action);
  if (session) return session;
  if (!isManagementAction(action)) return undefined;
  return MANAGEMENT_READS.has(action)
    ? "Read bounded application management state for the verified project. Missing native connectivity or activity remains unknown. Events are a sampled change feed, not a durable subscription. Read before writing."
    : "Request this exact application operation through native owner approval. Never supply approval. Keep requestId unchanged for retry and reconcile its receipt; pending or uncertain is not completion. Existing project, revision and execution gates remain enforced.";
}
export type ManagementReceipt = {
  signature: string;
  state: "pending" | "completed" | "failed" | "uncertain";
  result?: unknown;
  error?: string;
};
export type GlobalManagementPrincipal = {
  kind: "assistant-thread";
  threadId: string;
  environmentId: string;
  projectId?: undefined;
  sessionId?: undefined;
};
export function managementReceiptKey(
  principal: RuntimeLogSubjectPrincipal | GlobalManagementPrincipal,
  requestId: string,
): string {
  const subject =
    principal.kind === "assistant-thread"
      ? `thread:${principal.threadId}`
      : `session:${principal.sessionId}`;
  const scope =
    principal.projectId === undefined
      ? (principal as GlobalManagementPrincipal).environmentId
      : principal.projectId;
  return `management:${createHash("sha256")
    .update(JSON.stringify([scope, subject, requestId]))
    .digest("hex")}`;
}
export type ManagementPorts<
  A extends string = ManagementAction,
  P extends RuntimeLogSubjectPrincipal | GlobalManagementPrincipal = RuntimeLogSubjectPrincipal,
> = {
  execute(
    action: A,
    input: Record<string, unknown>,
    principal: P,
    authorized: () => Promise<boolean>,
  ): Promise<unknown>;
  approve(
    operation: { action: string; input: Record<string, unknown>; operationHash: string },
    principal: P,
    authorized: () => Promise<boolean>,
  ): Promise<{ approved?: boolean; operationHash?: string }>;
  receipt(key: string): Promise<ManagementReceipt | undefined>;
  saveReceipt(key: string, receipt: ManagementReceipt): Promise<void>;
};

/** Receipts persist before approval/effect. Restart never replays an unknown mutation. */
export class ConversationManagementTools<
  A extends string = ManagementAction,
  P extends RuntimeLogSubjectPrincipal | GlobalManagementPrincipal = RuntimeLogSubjectPrincipal,
> {
  private pending = new Map<string, { signature: string; promise: Promise<unknown> }>();
  constructor(
    private readonly ports: ManagementPorts<A, P>,
    private readonly readActions: ReadonlySet<string> = MANAGEMENT_READS,
  ) {}
  async call(
    action: A,
    input: Record<string, unknown>,
    principal: P,
    authorized: () => Promise<boolean>,
    qualify: <T>(effect: () => Promise<T>) => Promise<T> = (effect) => effect(),
  ) {
    const check = async () => {
      if (!(await authorized())) throw new Error("Conversation authority revoked.");
    };
    await check();
    if (this.readActions.has(action)) {
      const value = await qualify(() => this.ports.execute(action, input, principal, authorized));
      await check();
      return value;
    }
    if (typeof input.requestId !== "string" || !input.requestId)
      throw new Error("Management requestId required.");
    if (action === "commands.dispatch") managementCommand(input.command, input.requestId);
    const key = managementReceiptKey(principal, input.requestId);
    const signature = createHash("sha256")
      .update(JSON.stringify([action, input]))
      .digest("hex");
    const previous = await this.ports.receipt(key);
    await check();
    if (previous) {
      if (previous.signature !== signature)
        throw new Error("Management request ID was reused with different input.");
      return {
        requestId: input.requestId,
        ...previous,
        state: previous.state === "pending" ? "uncertain" : previous.state,
      };
    }
    const pending = this.pending.get(key);
    if (pending) {
      if (pending.signature !== signature)
        throw new Error("Management request ID was reused with different input.");
      const result = await pending.promise;
      await check();
      return result;
    }
    const operation = (async () => {
      await this.ports.saveReceipt(key, { signature, state: "pending" });
      let admitted = false;
      try {
        await check();
        const approved = await this.ports.approve(
          { action, input, operationHash: signature },
          principal,
          authorized,
        );
        await check();
        if (!approved.approved || approved.operationHash !== signature)
          throw new Error("Native owner approval required.");
        admitted = true;
        const result = await qualify(() =>
          this.ports.execute(action, input, principal, authorized),
        );
        await check();
        const receipt: ManagementReceipt = { signature, state: "completed", result };
        await this.ports.saveReceipt(key, receipt);
        return { requestId: input.requestId, ...receipt };
      } catch (error) {
        const receipt: ManagementReceipt = {
          signature,
          state: admitted ? "uncertain" : "failed",
          error: error instanceof Error ? error.message : "Management operation failed.",
        };
        await this.ports.saveReceipt(key, receipt);
        return { requestId: input.requestId, ...receipt };
      }
    })();
    this.pending.set(key, { signature, promise: operation });
    try {
      return await operation;
    } finally {
      this.pending.delete(key);
    }
  }
}

export function managementPage<T>(items: T[], input: Record<string, unknown>) {
  const offset = Number(input.offset ?? 0),
    limit = Number(input.limit ?? 30);
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  )
    throw new Error("Invalid management page.");
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    nextOffset: offset + limit < items.length ? offset + limit : null,
  };
}

export function pageDesktopManagementSnapshot(
  value: unknown,
  input: Record<string, unknown>,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const result = { ...value } as Record<string, unknown>;
  const pagination: Record<string, unknown> = {};
  for (const key of [
    "templates",
    "accounts",
    "mcp",
    "groups",
    "folders",
    "sessions",
    "sessionIds",
    "loose",
    "pinned",
  ]) {
    if (!Array.isArray(result[key])) continue;
    const page = managementPage(result[key], input);
    result[key] = page.items;
    pagination[key] = { total: page.total, nextOffset: page.nextOffset };
  }
  if (Array.isArray(result.providers))
    result.providers = result.providers.map((entry: Record<string, unknown>) => {
      if (!Array.isArray(entry.models)) return entry;
      const page = managementPage(entry.models, input);
      return {
        ...entry,
        models: page.items,
        modelPagination: { total: page.total, nextOffset: page.nextOffset },
      };
    });
  if (Array.isArray(result.folders))
    result.folders = result.folders.map((entry) =>
      pageDesktopManagementSnapshot(entry, { ...input, offset: input.memberOffset ?? 0 }),
    );
  if (result.order) result.order = pageDesktopManagementSnapshot(result.order, input);
  if (result.snapshot) result.snapshot = pageDesktopManagementSnapshot(result.snapshot, input);
  return { ...result, pagination };
}
