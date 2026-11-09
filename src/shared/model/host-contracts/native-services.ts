import { z } from "zod";
import { IdentifierSchema, JsonObjectSchema, JsonValueSchema, SafeCounterSchema } from "./schemas";

// Serialized UTF-8 output limit of the bounded formatter worker. Legacy delivery reads retain32MiB.
export const NATIVE_FORMAT_MAX_RESULT_BYTES = 4 * 1024 * 1024;

const empty = z.strictObject({});
const assistantPresence = z.strictObject({
  state: z.enum(["present", "idle", "away", "dnd", "unknown"]),
  assistantName: z.string().optional(),
  setupComplete: z.boolean(),
});
const scope = z.strictObject({
  projectId: z.string(),
  provider: z.string(),
  sessionId: z.string(),
  environmentId: z.string(),
});
const access = z.strictObject({ sessionId: z.string(), expectedScope: scope.optional() });
const desktopRelayRequest = {
  id: z.string(),
  action: z.string(),
  input: JsonObjectSchema,
  environmentId: z.string(),
  deadline: SafeCounterSchema,
};
const describe = z.strictObject({
  command: z.string(),
  args: z.array(z.string()),
  mcpUrl: z.string().optional(),
});
// Only the conversation bridge carries hub servers; other describes stay exactly as before.
const conversationDescribe = describe.extend({ externalMcp: JsonObjectSchema.optional() });
const grant = z.strictObject({
  token: z.string(),
  expiresAt: SafeCounterSchema,
  scope: scope.optional(),
  environmentId: z.string(),
  endpoint: z.string().optional(),
  command: z.string(),
  args: z.array(z.string()),
});
const mapping = z.record(z.string(), z.string());
const peerParams = z.strictObject({ environmentId: z.string(), endpoint: z.string(), mapping });
const status = z.strictObject({
  environmentId: z.string(),
  authority: z.strictObject({ environmentId: z.string(), mapping }).nullable(),
  projects: z.array(z.strictObject({ id: z.string(), name: z.string() })),
});
export const NativeDesktopFinishParamsSchema = z.strictObject({
  id: z.string(),
  result: JsonValueSchema.optional(),
  error: z.string().optional(),
});
export const NativeWorkspaceFormatParamsSchema = z.strictObject({
  command: z.literal("format_text_file"),
  args: z.strictObject({ path: z.string(), source: z.string(), cursorOffset: SafeCounterSchema }),
});
export const NATIVE_SERVICES_RPC_SCHEMAS = {
  "native.services.assistant.observations.ingest": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.publicKey": {
    params: z.strictObject({}),
    result: z.strictObject({ publicKey: z.string(), environmentId: z.string() }),
  },
  "native.services.assistant.delegation.origin": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.nativeChallenge": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.attest": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: z.strictObject({ signature: z.string() }),
  },
  "native.services.assistant.delegation.issue": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.issue.status": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.challenge": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.delegation.call": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonValueSchema,
  },
  "native.services.assistant.delegation.revoke": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.visibility.epoch": {
    params: empty,
    result: z.strictObject({ epoch: SafeCounterSchema }),
  },
  "native.services.assistant.visibility.revoke": {
    params: empty,
    result: z.strictObject({ epoch: SafeCounterSchema }),
  },
  "native.services.assistant.visibility.reopen": {
    params: z.strictObject({ input: JsonObjectSchema }),
    result: z.strictObject({ epoch: SafeCounterSchema }),
  },
  "native.services.assistant.notification.authorize": {
    params: z.strictObject({
      input: z.strictObject({
        threadId: z.string(),
        notificationId: z.string(),
        operationHash: z.string(),
      }),
    }),
    result: z.strictObject({ authorized: z.boolean() }),
  },
  "native.services.assistant.workspace.authorize": {
    params: z.strictObject({
      input: z.strictObject({
        threadId: z.string(),
        requestId: z.string(),
        operationHash: z.string(),
      }),
    }),
    result: z.strictObject({ authorized: z.boolean() }),
  },
  "native.services.assistant.browser.panel": {
    // Filesystem paths are bounded by the owner in UTF-16, as with FilesReadParamsSchema.
    params: z.strictObject({
      environmentId: IdentifierSchema,
      projectId: IdentifierSchema,
      threadId: IdentifierSchema,
      projectCwd: z.string(),
      action: z.enum([
        "browser.status",
        "browser.claim",
        "browser.release",
        "browser.open",
        "browser.frame",
        "browser.resize",
        "browser.input",
        "browser.close",
        "browser.operation.status",
      ]),
      input: JsonObjectSchema,
      requestId: IdentifierSchema,
    }),
    result: JsonObjectSchema,
  },
  "native.services.assistant.presence.get": { params: empty, result: assistantPresence },
  "native.services.assistant.presence.set": {
    params: z.strictObject({ state: z.enum(["present", "away", "dnd"]) }),
    result: assistantPresence,
  },
  "native.services.desktop.status": {
    params: empty,
    result: z.strictObject({
      enabled: z.boolean(),
      active: z.boolean(),
      stopped: z.boolean(),
      currentAction: z.strictObject({ app: z.string(), action: z.string() }).optional(),
      assistantName: z.string().optional(),
    }),
  },
  "native.services.desktop.status.wait": {
    params: z.strictObject({
      afterRevision: z.string(),
      timeoutMs: z.number().int().min(1).max(25000),
    }),
    result: z.strictObject({ revision: z.string() }),
  },
  "native.services.desktop.stop": {
    params: empty,
    result: z.strictObject({ stopped: z.literal(true) }),
  },
  "native.services.runtimeLogs.bridge.describe": { params: empty, result: describe },
  "native.services.runtimeLogs.access.issue": { params: access, result: grant },
  "native.services.runtimeLogs.terminals.demand": {
    params: z.strictObject({ cwd: z.string(), terminalId: z.string() }),
    result: z.strictObject({ enabled: z.boolean(), background: z.boolean() }),
  },
  "native.services.runtimeLogs.terminals.append": {
    params: z.strictObject({
      cwd: z.string(),
      terminalId: z.string(),
      sequence: SafeCounterSchema,
      data: z.string(),
      interrupted: z.boolean().optional(),
      closed: z.boolean().optional(),
    }),
    result: z.strictObject({ accepted: z.boolean() }),
  },
  "native.services.conversation.bridge.describe": { params: empty, result: conversationDescribe },
  "native.services.conversation.access.issue": { params: access, result: grant },
  "native.services.conversation.desktop.take": {
    params: empty,
    // The relay hands out coding-session and assistant Room requests alike; a Room request
    // the desktop refused here was already claimed and stayed lost until its deadline.
    result: z
      .array(
        z.union([
          z.strictObject({ ...desktopRelayRequest, cwd: z.string(), sessionId: z.string() }),
          z.strictObject({
            ...desktopRelayRequest,
            threadId: z.string(),
            projectId: z.string().optional(),
            cwd: z.string().optional(),
            targetProjectCwd: z.string().optional(),
          }),
        ]),
      )
      .max(8),
  },
  "native.services.conversation.desktop.finish": {
    params: NativeDesktopFinishParamsSchema,
    result: z.strictObject({ accepted: z.literal(true) }),
  },
  "native.services.conversation.desktop.authorize": {
    params: z.strictObject({
      id: z.string(),
      action: z.enum([
        "ssh.workspace.approve",
        "workspace.projects.select",
        "workspace.sessions.create",
        "workspace.sessions.open",
        "workspace.sessions.submit",
        "workspace.sessions.submit.status",
        "workspace.sessions.stop",
        "privacy.scope.capture",
        "privacy.account.capture",
        "voice.generation.retire",
        "voice.generation.status",
        "voice.generation.source",
        "delegation.grants",
        "delegation.call",
        "inbox.room.execute",
        "inbox.room.scope",
        "observations.native.baseline",
        "observations.native.projectBaseline",
        "observations.native.projectComplete",
        "observations.native.complete",
        "workspace.operation.status",
        "workspace.operation.execute",
        "ui.tools.open",
        "ui.tools.status",
        "assistant.notification.deliver",
        "assistant.notification.status",
        "desktop.act.authorize",
        "management.write.authorize",
        "preferences.read",
        "preferences.templateRead",
        "preferences.patch",
        "preferences.status",
        "providerManagement.read",
        "providerManagement.patch",
        "providerManagement.status",
        "providerManagement.quotaRefresh",
        "organization.read",
        "organization.patch",
        "organization.status",
        "servers.list",
        "servers.get",
        "servers.ssh.execute",
        "servers.ssh.status",
        "servers.ssh.cancel",
        "servers.ssh.save",
        "servers.ssh.remove",
        "ssh.workspace.close.approve",
        "ptyMobile.create",
        "ptyMobile.attach",
        "ptyMobile.write",
        "ptyMobile.resize",
        "ptyMobile.detach",
        "ptyMobile.close",
      ]),
    }),
    result: z.strictObject({ authorized: z.boolean() }),
  },
  "native.services.social.bridge.describe": { params: empty, result: describe },
  "native.services.social.access.issue": { params: access, result: grant },
  "native.services.social.native.status": { params: empty, result: status },
  "native.services.social.native.enroll": {
    params: z.strictObject({ environmentId: z.string() }),
    result: z.strictObject({ token: z.string(), environmentId: z.string() }),
  },
  "native.services.social.native.register": {
    params: peerParams.extend({ token: z.string() }),
    result: z.strictObject({ connected: z.literal(true), environmentId: z.string(), mapping }),
  },
  "native.services.social.native.authority": { params: peerParams, result: status },
  "native.services.social.native.reset": { params: empty, result: status },
  "native.services.workspace.format": {
    params: NativeWorkspaceFormatParamsSchema,
    // Older Hosts forwarded formatter comments metadata. Retain that known
    // optional field so original recorded results can reconcile without replay.
    result: z
      .strictObject({
        formatted: z.string(),
        cursorOffset: SafeCounterSchema,
        comments: z.array(JsonValueSchema).optional(),
      })
      .nullable(),
  },
} as const;
// Preserve domain UTF-16 path bounds without exporting Unicode-incompatible checks.
export const NativeAssistantBrowserPanelParamsSchema = NATIVE_SERVICES_RPC_SCHEMAS[
  "native.services.assistant.browser.panel"
].params.extend({
  // oxlint-disable-next-line no-control-regex -- rejects NUL bytes in untrusted project paths
  projectCwd: z.string().regex(/^[^\u0000]{1,4096}(?![\s\S])/),
});
export type NativeServiceMethod = keyof typeof NATIVE_SERVICES_RPC_SCHEMAS;
export const NATIVE_SERVICE_METHODS = Object.freeze(
  Object.keys(NATIVE_SERVICES_RPC_SCHEMAS) as NativeServiceMethod[],
);
export function nativeServiceReadOnly(method: NativeServiceMethod): boolean {
  return (
    method === "native.services.desktop.status.wait" ||
    method === "native.services.assistant.presence.get" ||
    method === "native.services.assistant.visibility.epoch" ||
    method === "native.services.assistant.notification.authorize" ||
    method === "native.services.assistant.workspace.authorize" ||
    method.endsWith(".bridge.describe") ||
    method.endsWith(".desktop.authorize") ||
    method.endsWith(".native.status")
  );
}
