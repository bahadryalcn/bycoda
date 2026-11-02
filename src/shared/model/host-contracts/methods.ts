import {
  DEVICE_LIFECYCLE_RPC_SCHEMAS,
  MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS,
  type DeviceLifecycleMethod,
  type MobileDevicePreviewMethod,
} from "./native-devices";
import { NATIVE_DELIVERY_RPC_SCHEMAS, type NativeDeliveryMethod } from "./native-delivery";
import {
  NATIVE_DEVICES_RPC_SCHEMAS,
  nativeDeviceReadOnly,
  type NativeDeviceMethod,
} from "./native-devices";
import { z } from "zod";
import { AssistantRequestSchema, AssistantResponseSchema } from "./assistant";
import { DesktopControlRequestSchema, DesktopControlResponseSchema } from "./desktop-control";
import { DesktopHelperRequestSchema, DesktopHelperResponseSchema } from "./desktop-helper";
import { hostRpcWireMethod } from "./aliases";
import { ModelsListParamsSchema, ModelsListResultSchema } from "./models";
import {
  NATIVE_SERVICES_RPC_SCHEMAS,
  nativeServiceReadOnly,
  type NativeServiceMethod,
} from "./native-services";
import {
  NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS,
  type NativeServiceUploadMethod,
} from "./native-service-upload";
import { NATIVE_WORKSPACE_RPC_SCHEMAS, type NativeWorkspaceMethod } from "./native-workspaces";
import {
  NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS,
  type NativeBufferUploadMethod,
} from "./native-buffer-upload";
import {
  NativeBufferRecoveryListParamsSchema,
  NativeBufferRecoverySourceSchema,
  NativeBufferRecoveryPageSchema,
  NativeBufferRecoveryReadSchema,
  NativeBufferRecoveryStatusSchema,
} from "./native-buffer-recovery";
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
import { CREWS_RPC_SCHEMAS } from "./crews";
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
/** Healthy slow Host reads (git, files, session sync, project browse) must outlive the 12 s default. */
const SLOW_READ_RESPONSE_TIMEOUT_MS = 30_000;
const GIT_ACTION_RESPONSE_TIMEOUT_MS = 600_000;
const sessionRead = (
  params: z.ZodType,
  result: z.ZodType = JsonValueSchema,
): HostRpcMethodDefinition => ({
  ...read(params, result),
  responseTimeoutMs: SLOW_READ_RESPONSE_TIMEOUT_MS,
  requiredCapability: "transport.ws.sessions.v2",
});
const fileRead = (params: z.ZodType, result: z.ZodType): HostRpcMethodDefinition => ({
  ...read(params, result),
  responseTimeoutMs: SLOW_READ_RESPONSE_TIMEOUT_MS,
  requiredCapability: "transport.ws.files.v2",
});
const fileMutation = (params: z.ZodType, result: z.ZodType): HostRpcMethodDefinition => ({
  ...control(params, result),
  cost: "read",
  responseTimeoutMs: SLOW_READ_RESPONSE_TIMEOUT_MS,
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
  responseTimeoutMs: mutation ? 120_000 : SLOW_READ_RESPONSE_TIMEOUT_MS,
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
  responseTimeoutMs: SLOW_READ_RESPONSE_TIMEOUT_MS,
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
const crewOperation = (method: keyof typeof CREWS_RPC_SCHEMAS): HostRpcMethodDefinition => ({
  ...workflowOperation(
    "transport.ws.crews.v2",
    CREWS_RPC_SCHEMAS[method].params,
    CREWS_RPC_SCHEMAS[method].result,
    method === "crews.schema" || method === "crews.inspect" || method === "crews.get",
  ),
  cost: method === "crews.stop" ? "control" : "read",
});

const nativeWorkspaceOperation = (method: NativeWorkspaceMethod): HostRpcMethodDefinition => {
  const schema = NATIVE_WORKSPACE_RPC_SCHEMAS[method];
  const readOnly =
    method === "native.rewind.lookup" ||
    method === "workspaces.cleanup.plan" ||
    method === "workspaces.cleanup.status";
  return {
    ...(readOnly ? read(schema.params, schema.result) : control(schema.params, schema.result)),
    // Buffer reporting and Git capture must not exhaust Stop/receipt capacity.
    cost: "read",
    requiredCapability: method.startsWith("workspaces.")
      ? "transport.ws.workspaces.cleanup.v1"
      : "native.workspaces.v1",
    responseTimeoutMs: 30_000,
  };
};

const nativeBufferUploadOperation = (
  method: NativeBufferUploadMethod,
): HostRpcMethodDefinition => ({
  ...(method === "native.buffers.upload.status"
    ? read(
        NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].params,
        NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].result,
      )
    : control(
        NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].params,
        NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: "native.buffers.upload.v1",
  responseTimeoutMs: 30_000,
});

const nativeServiceOperation = (method: NativeServiceMethod): HostRpcMethodDefinition => ({
  ...(nativeServiceReadOnly(method)
    ? read(NATIVE_SERVICES_RPC_SCHEMAS[method].params, NATIVE_SERVICES_RPC_SCHEMAS[method].result)
    : control(
        NATIVE_SERVICES_RPC_SCHEMAS[method].params,
        NATIVE_SERVICES_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: "native.services.v1",
  responseTimeoutMs: 30_000,
});
const nativeServiceUploadOperation = (
  method: NativeServiceUploadMethod,
): HostRpcMethodDefinition => ({
  ...(method === "native.services.upload.status"
    ? read(
        NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].params,
        NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].result,
      )
    : control(
        NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].params,
        NATIVE_SERVICE_UPLOAD_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: "native.services.v1",
  responseTimeoutMs: 30_000,
});

const nativeDeviceOperation = (method: NativeDeviceMethod): HostRpcMethodDefinition => ({
  ...(nativeDeviceReadOnly(method)
    ? read(NATIVE_DEVICES_RPC_SCHEMAS[method].params, NATIVE_DEVICES_RPC_SCHEMAS[method].result)
    : control(
        NATIVE_DEVICES_RPC_SCHEMAS[method].params,
        NATIVE_DEVICES_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: "transport.ws.devices.v1",
  responseTimeoutMs:
    method === "devices.boot"
      ? 240_000
      : method === "devices.start"
        ? 60_000
        : method === "devices.action" || method === "devices.capture"
          ? 180_000
          : 30_000,
});
const deviceLifecycleOperation = (method: DeviceLifecycleMethod): HostRpcMethodDefinition => ({
  ...control(
    DEVICE_LIFECYCLE_RPC_SCHEMAS[method].params,
    DEVICE_LIFECYCLE_RPC_SCHEMAS[method].result,
  ),
  cost: "read",
  requiredCapability: "transport.ws.devices.v1",
  responseTimeoutMs: method === "devices.setup" ? 1_230_000 : 30_000,
});
const mobileDevicePreviewOperation = (
  method: MobileDevicePreviewMethod,
): HostRpcMethodDefinition => ({
  ...(method === "devices.preview.mobile.start"
    ? control(
        MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS[method].params,
        MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS[method].result,
      )
    : read(
        MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS[method].params,
        MOBILE_DEVICE_PREVIEW_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: "transport.ws.devices.preview.mobile.v1",
  responseTimeoutMs: 30_000,
});
const nativeDeliveryOperation = (method: NativeDeliveryMethod): HostRpcMethodDefinition => ({
  ...(method.endsWith(".status") || method.endsWith(".result.read")
    ? read(NATIVE_DELIVERY_RPC_SCHEMAS[method].params, NATIVE_DELIVERY_RPC_SCHEMAS[method].result)
    : control(
        NATIVE_DELIVERY_RPC_SCHEMAS[method].params,
        NATIVE_DELIVERY_RPC_SCHEMAS[method].result,
      )),
  cost: "read",
  requiredCapability: method.startsWith("native.delivery.epochs.")
    ? "native.delivery.epochs.v2"
    : method.endsWith(".ack")
      ? method.startsWith("native.buffers.")
        ? "native.buffers.delivery.ack.v1"
        : "native.services.delivery.ack.v1"
      : method.startsWith("native.buffers.")
        ? "native.buffers.delivery.v1"
        : "native.services.delivery.v1",
  responseTimeoutMs: 30_000,
});
export const HOST_RPC_METHODS = Object.freeze({
  "assistant.request": workflowOperation("assistant.v1", AssistantRequestSchema, AssistantResponseSchema),
  "desktop.request": workflowOperation("desktop.control.v1", DesktopControlRequestSchema, DesktopControlResponseSchema),
  "desktop.helper.request":workflowOperation("desktop.control.v1",DesktopHelperRequestSchema,DesktopHelperResponseSchema),
  "native.delivery.epochs.open": nativeDeliveryOperation("native.delivery.epochs.open"),
  "native.delivery.epochs.status": nativeDeliveryOperation("native.delivery.epochs.status"),
  "native.delivery.epochs.compact": nativeDeliveryOperation("native.delivery.epochs.compact"),
  "native.delivery.epochs.close": nativeDeliveryOperation("native.delivery.epochs.close"),
  "native.buffers.delivery.ack": nativeDeliveryOperation("native.buffers.delivery.ack"),
  "native.services.delivery.ack": nativeDeliveryOperation("native.services.delivery.ack"),
  "native.buffers.delivery.apply": nativeDeliveryOperation("native.buffers.delivery.apply"),
  "native.buffers.delivery.status": nativeDeliveryOperation("native.buffers.delivery.status"),
  "native.services.delivery.apply": nativeDeliveryOperation("native.services.delivery.apply"),
  "native.services.delivery.status": nativeDeliveryOperation("native.services.delivery.status"),
  "native.services.delivery.result.read": nativeDeliveryOperation(
    "native.services.delivery.result.read",
  ),
  "devices.setup": deviceLifecycleOperation("devices.setup"),
  "devices.stop": deviceLifecycleOperation("devices.stop"),
  "devices.preview.mobile.start": mobileDevicePreviewOperation("devices.preview.mobile.start"),
  "devices.preview.mobile.status": mobileDevicePreviewOperation("devices.preview.mobile.status"),
  "devices.preview.impact": mobileDevicePreviewOperation("devices.preview.impact"),

  "devices.status": nativeDeviceOperation("devices.status"),
  "devices.preflight": nativeDeviceOperation("devices.preflight"),
  "devices.preview": nativeDeviceOperation("devices.preview"),
  "devices.preview.status": nativeDeviceOperation("devices.preview.status"),
  "devices.list": nativeDeviceOperation("devices.list"),
  "devices.start": nativeDeviceOperation("devices.start"),
  "devices.boot": nativeDeviceOperation("devices.boot"),
  "devices.capture": nativeDeviceOperation("devices.capture"),
  "devices.action": nativeDeviceOperation("devices.action"),

  "native.services.upload.begin": nativeServiceUploadOperation("native.services.upload.begin"),
  "native.services.upload.append": nativeServiceUploadOperation("native.services.upload.append"),
  "native.services.upload.commit": nativeServiceUploadOperation("native.services.upload.commit"),
  "native.services.upload.status": nativeServiceUploadOperation("native.services.upload.status"),
  "native.services.upload.cancel": nativeServiceUploadOperation("native.services.upload.cancel"),
  "native.services.runtimeLogs.bridge.describe": nativeServiceOperation(
    "native.services.runtimeLogs.bridge.describe",
  ),
  "native.services.runtimeLogs.access.issue": nativeServiceOperation(
    "native.services.runtimeLogs.access.issue",
  ),
  "native.services.runtimeLogs.terminals.append": nativeServiceOperation(
    "native.services.runtimeLogs.terminals.append",
  ),
  "native.services.conversation.bridge.describe": nativeServiceOperation(
    "native.services.conversation.bridge.describe",
  ),
  "native.services.conversation.access.issue": nativeServiceOperation(
    "native.services.conversation.access.issue",
  ),
  "native.services.conversation.desktop.take": nativeServiceOperation(
    "native.services.conversation.desktop.take",
  ),
  "native.services.desktop.stop":nativeServiceOperation("native.services.desktop.stop"),
  "native.services.assistant.presence.get":nativeServiceOperation("native.services.assistant.presence.get"),
  "native.services.assistant.presence.set":nativeServiceOperation("native.services.assistant.presence.set"),
  "native.services.desktop.status":nativeServiceOperation("native.services.desktop.status"),
  "native.services.conversation.desktop.finish": nativeServiceOperation(
    "native.services.conversation.desktop.finish",
  ),
  "native.services.conversation.desktop.authorize": nativeServiceOperation(
    "native.services.conversation.desktop.authorize",
  ),
  "native.services.social.bridge.describe": nativeServiceOperation(
    "native.services.social.bridge.describe",
  ),
  "native.services.social.access.issue": nativeServiceOperation(
    "native.services.social.access.issue",
  ),
  "native.services.social.native.status": nativeServiceOperation(
    "native.services.social.native.status",
  ),
  "native.services.social.native.enroll": nativeServiceOperation(
    "native.services.social.native.enroll",
  ),
  "native.services.social.native.register": nativeServiceOperation(
    "native.services.social.native.register",
  ),
  "native.services.social.native.authority": nativeServiceOperation(
    "native.services.social.native.authority",
  ),
  "native.services.social.native.reset": nativeServiceOperation(
    "native.services.social.native.reset",
  ),
  "native.services.workspace.format": nativeServiceOperation("native.services.workspace.format"),
  "models.list": {
    ...read(ModelsListParamsSchema, ModelsListResultSchema),
    requiredCapability: "transport.ws.models.v1",
    responseTimeoutMs: 60_000,
  },
  "native.buffers.upload.start": nativeBufferUploadOperation("native.buffers.upload.start"),
  "native.buffers.upload.write": nativeBufferUploadOperation("native.buffers.upload.write"),
  "native.buffers.upload.commit": nativeBufferUploadOperation("native.buffers.upload.commit"),
  "native.buffers.upload.status": nativeBufferUploadOperation("native.buffers.upload.status"),
  "native.buffers.upload.abort": nativeBufferUploadOperation("native.buffers.upload.abort"),
  "native.turn.begin": nativeWorkspaceOperation("native.turn.begin"),
  "native.turn.end": nativeWorkspaceOperation("native.turn.end"),
  "native.activity.start": nativeWorkspaceOperation("native.activity.start"),
  "native.activity.end": nativeWorkspaceOperation("native.activity.end"),
  "native.buffers.update": nativeWorkspaceOperation("native.buffers.update"),
  "native.buffers.retire": nativeWorkspaceOperation("native.buffers.retire"),
  "native.buffers.reconcile": nativeWorkspaceOperation("native.buffers.reconcile"),
  "native.rewind.plan": nativeWorkspaceOperation("native.rewind.plan"),
  "native.rewind.prepare": nativeWorkspaceOperation("native.rewind.prepare"),
  "native.rewind.apply": nativeWorkspaceOperation("native.rewind.apply"),
  "native.rewind.status": nativeWorkspaceOperation("native.rewind.status"),
  "native.rewind.lookup": nativeWorkspaceOperation("native.rewind.lookup"),
  "native.rewind.cancelPreparation": nativeWorkspaceOperation("native.rewind.cancelPreparation"),
  "native.rewind.ack": nativeWorkspaceOperation("native.rewind.ack"),
  "workspaces.cleanup.plan": nativeWorkspaceOperation("workspaces.cleanup.plan"),
  "workspaces.cleanup.apply": nativeWorkspaceOperation("workspaces.cleanup.apply"),
  "workspaces.cleanup.status": nativeWorkspaceOperation("workspaces.cleanup.status"),
  "native.buffers.recovery.list": {
    ...read(NativeBufferRecoveryListParamsSchema, NativeBufferRecoveryPageSchema),
    requiredCapability: "native.buffers.recovery.v1",
  },
  "native.buffers.recovery.read": {
    ...read(NativeBufferRecoverySourceSchema, NativeBufferRecoveryReadSchema),
    requiredCapability: "native.buffers.recovery.v1",
  },
  "native.buffers.recovery.status": {
    ...read(NativeBufferRecoverySourceSchema, NativeBufferRecoveryStatusSchema),
    requiredCapability: "native.buffers.recovery.v1",
  },
  "crews.list": crewOperation("crews.list"),
  "crews.schema": crewOperation("crews.schema"),
  "crews.inspect": crewOperation("crews.inspect"),
  "crews.save": crewOperation("crews.save"),
  "crews.delete": crewOperation("crews.delete"),
  "crews.deleteRun": crewOperation("crews.deleteRun"),
  "crews.agent.save": crewOperation("crews.agent.save"),
  "crews.agent.delete": crewOperation("crews.agent.delete"),
  "crews.start": crewOperation("crews.start"),
  "crews.get": crewOperation("crews.get"),
  "crews.assign": crewOperation("crews.assign"),
  "crews.request": crewOperation("crews.request"),
  "crews.resolve": crewOperation("crews.resolve"),
  "crews.respond": crewOperation("crews.respond"),
  "crews.answer": crewOperation("crews.answer"),
  "crews.pause": crewOperation("crews.pause"),
  "crews.stop": crewOperation("crews.stop"),
  "crews.resume": crewOperation("crews.resume"),
  "crews.accept": crewOperation("crews.accept"),
  "crews.finish": crewOperation("crews.finish"),
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
    "transport.ws.stewards.v2",
    stewardsDto.StewardsEmptyParamsSchema,
    stewardsDto.StewardsListResultSchema,
    true,
  ),
  "stewards.save": workflowOperation(
    "transport.ws.stewards.v2",
    stewardsDto.StewardsSaveParamsSchema,
    stewardsDto.HostStewardSchema,
  ),
  "stewards.delete": workflowOperation(
    "transport.ws.stewards.v2",
    stewardsDto.StewardsIdParamsSchema,
    stewardsDto.StewardsDeleteResultSchema,
  ),
  "stewards.runNow": workflowOperation(
    "transport.ws.stewards.v2",
    stewardsDto.StewardsIdParamsSchema,
    stewardsDto.HostStewardSchema,
  ),
  "stewards.decline": workflowOperation(
    "transport.ws.stewards.v2",
    stewardsDto.StewardsDeclineParamsSchema,
    stewardsDto.StewardsDeclineResultSchema,
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
  "git.action": {
    ...gitOperation(gitDto.GitActionParamsSchema, gitDto.GitActionResultSchema, true),
    responseTimeoutMs: GIT_ACTION_RESPONSE_TIMEOUT_MS,
  },
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

/** Private Native workspace and development-server gateway ingress. Canonical
 * declaration alone grants neither mobile/window ingress nor gateway access. */
export function nativeDesktopMethod(method: string): boolean {
  const wireMethod = hostRpcWireMethod(method);
  return wireMethod.startsWith("native.") || wireMethod.startsWith("devServers.bridge");
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
