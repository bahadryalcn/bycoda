import { z } from "zod";
import { WS_LIMITS } from "./policy";
import * as gitDto from "./git";
import * as notesDto from "./notes";
import * as projectsDto from "./projects";
import * as tasksDto from "./tasks";
import * as goalsDto from "./goals";
import * as devDto from "./dev-servers";
import * as sprintsDto from "./sprints";
import * as automationsDto from "./automations";
import * as stewardsDto from "./stewards";
import { HostPersistenceParamsSchema, HostPersistenceStatusSchema } from "./persistence";
import {
  HostTerminalSchema,
  HostTerminalListSchema,
  HostTerminalReadSchema,
  TerminalsListParamsSchema,
  TerminalsCreateParamsSchema,
  TerminalsReadParamsSchema,
  TerminalsWriteParamsSchema,
  TerminalsControlParamsSchema,
} from "./terminals";
import {
  FilesReadParamsSchema,
  FilesListParamsSchema,
  FilesIndexParamsSchema,
  FilesSearchParamsSchema,
  FilesSearchContentParamsSchema,
  FilesCreateParamsSchema,
  FilesWriteParamsSchema,
  HostFileListSchema,
  HostContentSearchResultSchema,
} from "./files";
import {
  CommandDispatchParamsSchema,
  CommandReceiptSchema,
  CommandsStatusParamsSchema,
  CommandsStatusResultSchema,
} from "./session-commands";
import {
  SessionsListParamsSchema,
  SessionsListResultSchema,
  SessionsPageParamsSchema,
  SessionsPageResultSchema,
  SessionsSyncParamsSchema,
  SessionSyncResponseSchema,
  SessionsSyncChunkParamsSchema,
  SessionsSyncChunkResultSchema,
  SessionsGetParamsSchema,
  SessionViewSchema,
  SessionsBlockParamsSchema,
} from "./session-reads";
import {
  SessionsQueueGetParamsSchema,
  SessionsQueueChangeParamsSchema,
  SessionsQueueClaimParamsSchema,
  SessionsQueueFinishParamsSchema,
  SessionsQueueLeaseParamsSchema,
  SessionsQueueReleaseParamsSchema,
  SharedSessionQueueSchema,
} from "./session-queue";
import {
  ConnectionHelloParamsSchema,
  ConnectionHelloResultSchema,
  ConnectionProbeParamsSchema,
  ConnectionProbeResultSchema,
  ControlAcceptedSchema,
  IdentifierSchema,
  JsonObjectSchema,
  JsonValueSchema,
  RequestCancelParamsSchema,
  SubscriptionAckParamsSchema,
  SubscriptionCloseParamsSchema,
  SubscriptionOpenParamsSchema,
  SubscriptionOpenResultSchema,
  type JsonObject,
} from "./schemas";

export type HostRpcMethodDefinition = {
  readonly kind: "query" | "command" | "control" | "subscription";
  readonly scope: "device";
  readonly retry: "safe-query" | "receipt-lookup" | "never";
  readonly cancellation: "query" | "wait-only";
  readonly cost: "read" | "control";
  readonly requiredCapability?: string;
  /** Command variants which use reserved control capacity. This is not a retry rule. */
  readonly controlTypes?: readonly string[];
  readonly responseTimeoutMs: number;
  readonly admissionTimeoutMs: number;
  readonly paramsSchema: z.ZodType;
  readonly resultSchema: z.ZodType;
};

const read = (
  paramsSchema: z.ZodType,
  resultSchema: z.ZodType = JsonValueSchema,
): HostRpcMethodDefinition => ({
  kind: "query",
  scope: "device",
  retry: "safe-query",
  cancellation: "query",
  cost: "read",
  requiredCapability: "transport.ws.read.v2",
  responseTimeoutMs: WS_LIMITS.defaultResponseTimeoutMs,
  admissionTimeoutMs: WS_LIMITS.defaultAdmissionTimeoutMs,
  paramsSchema,
  resultSchema,
});
const control = (
  paramsSchema: z.ZodType,
  resultSchema: z.ZodType,
  kind: "control" | "subscription" = "control",
): HostRpcMethodDefinition => ({
  kind,
  scope: "device",
  retry: "never",
  cancellation: "wait-only",
  cost: "control",
  responseTimeoutMs: WS_LIMITS.defaultResponseTimeoutMs,
  admissionTimeoutMs: WS_LIMITS.defaultAdmissionTimeoutMs,
  paramsSchema,
  resultSchema,
});
const queueOperation = (paramsSchema: z.ZodType): HostRpcMethodDefinition => ({
  ...control(paramsSchema, SharedSessionQueueSchema),
  // Polling get also mutates leases. It must not exhaust Stop/receipt capacity.
  cost: "read",
  requiredCapability: "transport.ws.queue.v2",
});
const sessionRead = (
  params: z.ZodType,
  result: z.ZodType = JsonValueSchema,
): HostRpcMethodDefinition => ({
  ...read(params, result),
  requiredCapability: "transport.ws.sessions.v2",
});
const fileRead = (params: z.ZodType, result: z.ZodType): HostRpcMethodDefinition => ({
  ...read(params, result),
  requiredCapability: "transport.ws.files.v2",
});
const fileMutation = (params: z.ZodType, result: z.ZodType): HostRpcMethodDefinition => ({
  ...control(params, result),
  cost: "read",
  requiredCapability: "transport.ws.files.v2",
});
const terminalOperation = (
  params: z.ZodType,
  result: z.ZodType,
  query = false,
  reserved = false,
): HostRpcMethodDefinition => ({
  ...(query ? read(params, result) : control(params, result)),
  cost: reserved ? "control" : "read",
  requiredCapability: "transport.ws.terminals.v2",
});
const gitOperation = (
  params: z.ZodType,
  result: z.ZodType,
  mutation = false,
): HostRpcMethodDefinition => ({
  ...(mutation ? control(params, result) : read(params, result)),
  cost: "read",
  requiredCapability: "transport.ws.git.v2",
  responseTimeoutMs: mutation ? 120_000 : WS_LIMITS.defaultResponseTimeoutMs,
});
const notesOperation = (
  params: z.ZodType,
  result: z.ZodType,
  mutation = false,
): HostRpcMethodDefinition => ({
  ...(mutation ? control(params, result) : read(params, result)),
  cost: "read",
  requiredCapability: "transport.ws.notes.v2",
});
const projectOperation = (
  params: z.ZodType,
  result: z.ZodType,
  mutation = false,
): HostRpcMethodDefinition => ({
  ...(mutation ? control(params, result) : read(params, result)),
  cost: "read",
  requiredCapability: "transport.ws.read.v2",
});

const taskOperation = (
  params: z.ZodType,
  result: z.ZodType,
  query = false,
): HostRpcMethodDefinition => ({
  ...(query ? read(params, result) : control(params, result)),
  cost: "read",
  requiredCapability: "transport.ws.tasks.v2",
});

const goalOperation = (params: z.ZodType, result: z.ZodType): HostRpcMethodDefinition => ({
  ...control(params, result),
  cost: "read",
  requiredCapability: "transport.ws.goals.v2",
});

const devServerOperation = (
  params: z.ZodType,
  result: z.ZodType,
  query = false,
): HostRpcMethodDefinition => ({
  ...(query ? read(params, result) : control(params, result)),
  cost: "read",
  requiredCapability: "transport.ws.devServers.v2",
});

const workflowOperation = (
  requiredCapability: string,
  params: z.ZodType,
  result: z.ZodType,
  query = false,
): HostRpcMethodDefinition => ({
  ...(query ? read(params, result) : control(params, result)),
  cost: "read",
  requiredCapability,
});

/** A schema inventory, not an advertisement of routed or authorized capability. */
export const HOST_RPC_METHODS = Object.freeze({
  "connection.hello": control(ConnectionHelloParamsSchema, ConnectionHelloResultSchema),
  "connection.probe": control(ConnectionProbeParamsSchema, ConnectionProbeResultSchema),
  "subscriptions.open": {
    ...control(SubscriptionOpenParamsSchema, SubscriptionOpenResultSchema, "subscription"),
    requiredCapability: "transport.ws.streams.v2",
  },
  "subscriptions.ack": {
    ...control(SubscriptionAckParamsSchema, ControlAcceptedSchema, "subscription"),
    requiredCapability: "transport.ws.streams.v2",
  },
  "subscriptions.close": {
    ...control(SubscriptionCloseParamsSchema, ControlAcceptedSchema, "subscription"),
    requiredCapability: "transport.ws.streams.v2",
  },
  "requests.cancel": control(RequestCancelParamsSchema, ControlAcceptedSchema),
  "environment.describe": read(
    z.strictObject({ supportedProviders: z.array(IdentifierSchema).max(32).optional() }),
  ),
  "projects.list": projectOperation(
    projectsDto.ProjectsEmptyParamsSchema,
    z.array(projectsDto.HostProjectSchema),
  ),
  "projects.directory": projectOperation(
    projectsDto.ProjectsEmptyParamsSchema,
    projectsDto.ProjectDirectorySchema,
  ),
  "projects.browse": projectOperation(
    projectsDto.ProjectsBrowseParamsSchema,
    projectsDto.HostDirectorySchema,
  ),
  "projects.createDirectory": projectOperation(
    projectsDto.ProjectsCreateDirectoryParamsSchema,
    projectsDto.HostDirectorySchema,
    true,
  ),
  "projects.open": projectOperation(
    projectsDto.ProjectsOpenParamsSchema,
    projectsDto.HostProjectSchema,
    true,
  ),
  "environment.persistence.status": {
    ...read(HostPersistenceParamsSchema, HostPersistenceStatusSchema),
    cost: "control",
    requiredCapability: "transport.ws.health.v2",
  } satisfies HostRpcMethodDefinition,
  "environment.persistence.recover": {
    ...control(HostPersistenceParamsSchema, HostPersistenceStatusSchema),
    cost: "read",
    requiredCapability: "transport.ws.health.v2",
  } satisfies HostRpcMethodDefinition,
  "files.read": fileRead(FilesReadParamsSchema, z.string()),
  "files.list": fileRead(FilesListParamsSchema, HostFileListSchema),
  "files.index": fileRead(FilesIndexParamsSchema, z.array(z.string())),
  "files.search": fileRead(FilesSearchParamsSchema, HostFileListSchema),
  "files.searchContent": fileRead(FilesSearchContentParamsSchema, HostContentSearchResultSchema),
  "files.create": fileMutation(FilesCreateParamsSchema, z.string()),
  "files.write": fileMutation(FilesWriteParamsSchema, z.null()),
  "sprints.list": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsEmptyParamsSchema,
    sprintsDto.SprintBoardSchema,
    true,
  ),
  "sprints.get": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsIdParamsSchema,
    sprintsDto.SprintsGetResultSchema,
    true,
  ),
  "sprints.report": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsIdParamsSchema,
    sprintsDto.SprintReportSchema,
    true,
  ),
  "sprints.create": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsCreateParamsSchema,
    sprintsDto.HostSprintSchema,
  ),
  "sprints.update": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsUpdateParamsSchema,
    sprintsDto.HostSprintSchema,
  ),
  "sprints.start": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsCommandParamsSchema,
    sprintsDto.HostSprintSchema,
  ),
  "sprints.complete": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsCompleteParamsSchema,
    sprintsDto.HostSprintSchema,
  ),
  "sprints.archive": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsCommandParamsSchema,
    sprintsDto.HostSprintSchema,
  ),
  "sprints.plan": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsPlanParamsSchema,
    sprintsDto.SprintPlanItemSchema,
  ),
  "sprints.ingest": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsIngestParamsSchema,
    sprintsDto.SprintSourceStateSchema,
  ),
  "sprints.goalContext": workflowOperation(
    "transport.ws.sprints.v2",
    sprintsDto.SprintsGoalContextParamsSchema,
    sprintsDto.SprintGoalContextSchema,
  ),
  "automations.list": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsEmptyParamsSchema,
    z.array(automationsDto.HostAutomationSchema),
    true,
  ),
  "automations.preview": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsPreviewParamsSchema,
    automationsDto.AutomationsPreviewResultSchema,
    true,
  ),
  "automations.save": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsSaveParamsSchema,
    automationsDto.HostAutomationSchema,
  ),
  "automations.delete": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsIdParamsSchema,
    automationsDto.AutomationsDeleteResultSchema,
  ),
  "automations.runs": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsIdParamsSchema,
    z.array(automationsDto.HostAutomationRunSchema),
    true,
  ),
  "automations.runNow": workflowOperation(
    "transport.ws.automations.v2",
    automationsDto.AutomationsIdParamsSchema,
    automationsDto.HostAutomationRunSchema,
  ),
  "devServers.list": devServerOperation(
    devDto.DevServersListParamsSchema,
    devDto.DevServersListResultSchema,
    true,
  ),
  "devServers.details": devServerOperation(
    devDto.DevServersTargetParamsSchema,
    devDto.DevServersDetailsResultSchema,
    true,
  ),
  "devServers.start": devServerOperation(
    devDto.DevServersStartParamsSchema,
    devDto.DevServersStartRpcResultSchema,
  ),
  "devServers.stop": devServerOperation(
    devDto.DevServersTargetParamsSchema,
    devDto.DevServersStopResultSchema,
  ),
  "devServers.kill": devServerOperation(
    devDto.DevServersTargetParamsSchema,
    devDto.DevServersStopResultSchema,
  ),
  "devServers.restart": devServerOperation(
    devDto.DevServersRestartParamsSchema,
    devDto.DevServersStartResultSchema,
  ),
  "devServers.logs": devServerOperation(
    devDto.DevServersTargetParamsSchema,
    devDto.DevServersLogsResultSchema,
    true,
  ),
  "devServers.openExternal": devServerOperation(
    devDto.DevServersOpenExternalParamsSchema,
    devDto.DevServersOpenExternalResultSchema,
  ),
  "devServers.bridgeCheck": devServerOperation(
    devDto.DevServersBridgeEndpointParamsSchema,
    devDto.DevServersBridgeCheckResultSchema,
    true,
  ),
  "devServers.bridgeOpen": devServerOperation(
    devDto.DevServersBridgeEndpointParamsSchema,
    devDto.DevServersBridgeOpenResultSchema,
  ),
  // Consumes buffered bytes, so cancellation only stops waiting and never replays.
  "devServers.bridgeRead": devServerOperation(
    devDto.DevServersBridgeStreamParamsSchema,
    devDto.DevServersBridgeReadResultSchema,
  ),
  "devServers.bridgeWrite": devServerOperation(
    devDto.DevServersBridgeWriteParamsSchema,
    devDto.DevServersBridgeWriteResultSchema,
  ),
  "devServers.bridgeClose": devServerOperation(
    devDto.DevServersBridgeStreamParamsSchema,
    devDto.DevServersBridgeCloseResultSchema,
  ),
  // list reconciles progress/reviews and can write; it is not a retryable read.
  "goals.list": goalOperation(goalsDto.GoalsEmptyParamsSchema, goalsDto.GoalsListResultSchema),
  "goals.create": goalOperation(goalsDto.GoalsCreateParamsSchema, goalsDto.HostGoalSchema),
  "goals.finalReview.recheck": goalOperation(
    goalsDto.GoalsRecheckParamsSchema,
    goalsDto.HostGoalSchema,
  ),
  "goals.approve": goalOperation(goalsDto.GoalsIdParamsSchema, goalsDto.HostGoalSchema),
  "goals.update": goalOperation(goalsDto.GoalsUpdateParamsSchema, goalsDto.HostGoalSchema),
  "goals.replan": goalOperation(goalsDto.GoalsReplanParamsSchema, goalsDto.HostGoalSchema),
  "goals.cancel": goalOperation(goalsDto.GoalsIdParamsSchema, goalsDto.HostGoalSchema),
  "goals.delete": goalOperation(goalsDto.GoalsDeleteParamsSchema, goalsDto.GoalsDeleteResultSchema),
  "stewards.list": workflowOperation(
    "transport.ws.stewards.v2", stewardsDto.StewardsEmptyParamsSchema,
    stewardsDto.StewardsListResultSchema, true,
  ),
  "stewards.save": workflowOperation(
    "transport.ws.stewards.v2", stewardsDto.StewardsSaveParamsSchema, stewardsDto.HostStewardSchema,
  ),
  "stewards.delete": workflowOperation(
    "transport.ws.stewards.v2", stewardsDto.StewardsIdParamsSchema, stewardsDto.StewardsDeleteResultSchema,
  ),
  "stewards.runNow": workflowOperation(
    "transport.ws.stewards.v2", stewardsDto.StewardsIdParamsSchema, stewardsDto.HostStewardSchema,
  ),
  "stewards.decline": workflowOperation(
    "transport.ws.stewards.v2", stewardsDto.StewardsDeclineParamsSchema, stewardsDto.StewardsDeclineResultSchema,
  ),
  "tasks.snapshotWithCursor": taskOperation(
    tasksDto.TasksEmptyParamsSchema,
    tasksDto.TasksSnapshotResultSchema,
    true,
  ),
  "tasks.events": taskOperation(
    tasksDto.TasksEventsParamsSchema,
    tasksDto.TasksEventsResultSchema,
    true,
  ),
  "tasks.list": taskOperation(
    tasksDto.TasksListParamsSchema,
    z.array(tasksDto.HostTaskSchema),
    true,
  ),
  "tasks.save": taskOperation(tasksDto.TasksSaveParamsSchema, tasksDto.HostTaskSchema),
  "tasks.move": taskOperation(tasksDto.TasksMoveParamsSchema, tasksDto.HostTaskSchema),
  "tasks.start": taskOperation(tasksDto.TasksIdParamsSchema, tasksDto.HostTaskSchema),
  "tasks.reorder": taskOperation(
    tasksDto.TasksReorderParamsSchema,
    z.array(tasksDto.HostTaskSchema),
  ),
  "tasks.retarget": taskOperation(tasksDto.TasksRetargetParamsSchema, tasksDto.HostTaskSchema),
  "tasks.review.recheck": taskOperation(tasksDto.TasksIdParamsSchema, tasksDto.HostTaskSchema),
  // Read marks review notes as seen and writes a new version in the owner.
  "tasks.notes.read": taskOperation(tasksDto.TasksNotesReadParamsSchema, tasksDto.HostTaskSchema),
  "tasks.notes.resolve": taskOperation(
    tasksDto.TasksNotesResolveParamsSchema,
    tasksDto.HostTaskSchema,
  ),
  "tasks.delete": taskOperation(tasksDto.TasksDeleteParamsSchema, tasksDto.TasksDeleteResultSchema),
  "tasks.preflight": taskOperation(
    tasksDto.TasksSaveParamsSchema,
    tasksDto.TaskPreflightResultSchema,
    true,
  ),
  "tasks.evaluation.save": taskOperation(
    tasksDto.TasksEvaluationSaveParamsSchema,
    tasksDto.HostTaskSchema,
  ),
  "notes.list": notesOperation(notesDto.NotesListParamsSchema, notesDto.NotesListResultSchema),
  "notes.get": notesOperation(notesDto.NotesGetParamsSchema, notesDto.NotesGetResultSchema),
  "notes.upsert": notesOperation(notesDto.NotesUpsertParamsSchema, notesDto.HostNoteSchema, true),
  "notes.delete": notesOperation(
    notesDto.NotesDeleteParamsSchema,
    notesDto.NotesDeleteResultSchema,
    true,
  ),
  "git.diff": gitOperation(gitDto.GitReadParamsSchema, z.string()),
  "git.branches": gitOperation(gitDto.GitReadParamsSchema, gitDto.GitBranchesSchema),
  "git.worktrees": gitOperation(gitDto.GitReadParamsSchema, gitDto.GitWorktreesSchema),
  "git.index": gitOperation(gitDto.GitReadParamsSchema, gitDto.GitIndexSchema),
  "git.fileDiff": gitOperation(gitDto.GitFileDiffParamsSchema, gitDto.GitFileDiffSchema),
  "git.switch": gitOperation(gitDto.GitSwitchParamsSchema, gitDto.GitBranchesSchema, true),
  "git.createBranch": gitOperation(
    gitDto.GitCreateBranchParamsSchema,
    gitDto.GitBranchesSchema,
    true,
  ),
  "git.worktreeCreate": gitOperation(
    gitDto.GitWorktreeCreateParamsSchema,
    gitDto.GitWorktreeSchema,
    true,
  ),
  "git.action": gitOperation(gitDto.GitActionParamsSchema, gitDto.GitActionResultSchema, true),
  "terminals.list": terminalOperation(TerminalsListParamsSchema, HostTerminalListSchema, true),
  "terminals.create": terminalOperation(TerminalsCreateParamsSchema, HostTerminalSchema),
  "terminals.read": terminalOperation(TerminalsReadParamsSchema, HostTerminalReadSchema, true),
  "terminals.write": terminalOperation(TerminalsWriteParamsSchema, ControlAcceptedSchema),
  "terminals.interrupt": terminalOperation(
    TerminalsControlParamsSchema,
    ControlAcceptedSchema,
    false,
    true,
  ),
  "terminals.close": terminalOperation(
    TerminalsControlParamsSchema,
    z.strictObject({ closed: z.literal(true) }),
    false,
    true,
  ),
  "sessions.list": sessionRead(SessionsListParamsSchema, SessionsListResultSchema),
  "sessions.page": sessionRead(SessionsPageParamsSchema, SessionsPageResultSchema),
  "sessions.sync": sessionRead(SessionsSyncParamsSchema, SessionSyncResponseSchema),
  "sessions.syncChunk": sessionRead(SessionsSyncChunkParamsSchema, SessionsSyncChunkResultSchema),
  "sessions.get": sessionRead(SessionsGetParamsSchema, SessionViewSchema.nullable()),
  "sessions.block": sessionRead(SessionsBlockParamsSchema),
  "commands.status": {
    ...sessionRead(CommandsStatusParamsSchema, CommandsStatusResultSchema),
    cost: "control",
  } satisfies HostRpcMethodDefinition,
  // Even legacy get can renew a drain lease and establish attachment exposure.
  // Queue actions have no command receipt; reconcile the queue before another attempt.
  "sessions.queue.get": queueOperation(SessionsQueueGetParamsSchema),
  "sessions.queue.change": queueOperation(SessionsQueueChangeParamsSchema),
  "sessions.queue.claim": queueOperation(SessionsQueueClaimParamsSchema),
  "sessions.queue.finish": {
    ...control(SessionsQueueFinishParamsSchema, SharedSessionQueueSchema),
    requiredCapability: "transport.ws.queue.v2",
  },
  "sessions.queue.lease": queueOperation(SessionsQueueLeaseParamsSchema),
  "sessions.queue.release": {
    ...control(SessionsQueueReleaseParamsSchema, SharedSessionQueueSchema),
    requiredCapability: "transport.ws.queue.v2",
  },
  "commands.dispatch": {
    ...control(CommandDispatchParamsSchema, CommandReceiptSchema),
    kind: "command",
    retry: "receipt-lookup",
    cost: "read",
    controlTypes: ["cancel", "stopItem", "approve", "answer"],
    requiredCapability: "transport.ws.sessions.v2",
  } satisfies HostRpcMethodDefinition,
});
export type HostRpcMethod = keyof typeof HOST_RPC_METHODS;

export function getHostRpcMethod(method: string): HostRpcMethodDefinition | undefined {
  return Object.prototype.hasOwnProperty.call(HOST_RPC_METHODS, method)
    ? HOST_RPC_METHODS[method as HostRpcMethod]
    : undefined;
}

export function hostRpcCost(method: string, params: Record<string, unknown>): "read" | "control" {
  const definition = getHostRpcMethod(method);
  if (!definition) throw new Error("Unsupported Host RPC method.");
  return typeof params.type === "string" && definition.controlTypes?.includes(params.type)
    ? "control"
    : definition.cost;
}

/** Local schema availability alone does not mean this Host routes the method. */
export function hostRpcSupported(method: string, capabilities: readonly string[]): boolean {
  const definition = getHostRpcMethod(method);
  return (
    !!definition &&
    (!definition.requiredCapability || capabilities.includes(definition.requiredCapability))
  );
}

/** Registry presence is validation metadata, never permission or routing. */
export function parseHostRpcParams(method: string, params: unknown): JsonObject {
  const definition = getHostRpcMethod(method);
  if (!definition) throw new Error("Unsupported Host RPC method.");
  return JsonObjectSchema.parse(definition.paramsSchema.parse(params));
}

export type RpcRequest = {
  jsonrpc: "2.0";
  id: string;
  method: HostRpcMethod;
  params: JsonObject;
};
// Select the closed method schema before traversing input. An unrelated deeply
// nested unknown parameter must not force recursive generic JSON validation.
const requestVariants = Object.entries(HOST_RPC_METHODS).map(([method, definition]) =>
  z.strictObject({
    jsonrpc: z.literal("2.0"),
    id: IdentifierSchema,
    method: z.literal(method),
    params: definition.paramsSchema,
  }),
);
// The frozen registry is nonempty; preserve that invariant for Zod's tuple API.
export const RpcRequestSchema = z.discriminatedUnion(
  "method",
  requestVariants as [(typeof requestVariants)[number], ...(typeof requestVariants)[number][]],
) as z.ZodType<RpcRequest>;

/** Validates the envelope and then the closed schema selected by its method. */
export function parseRpcRequest(input: unknown): RpcRequest {
  const request = RpcRequestSchema.parse(input);
  return { ...request, params: parseHostRpcParams(request.method, request.params) };
}
