import { z } from "zod";
import { JsonObjectSchema, JsonValueSchema, SafeCounterSchema } from "./schemas";

const empty = z.strictObject({});
const scope = z.strictObject({
  projectId: z.string(),
  provider: z.string(),
  sessionId: z.string(),
  environmentId: z.string(),
});
const access = z.strictObject({ sessionId: z.string(), expectedScope: scope.optional() });
const describe = z.strictObject({
  command: z.string(),
  args: z.array(z.string()),
  mcpUrl: z.string().optional(),
});
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
  "native.services.runtimeLogs.bridge.describe": { params: empty, result: describe },
  "native.services.runtimeLogs.access.issue": { params: access, result: grant },
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
  "native.services.conversation.bridge.describe": { params: empty, result: describe },
  "native.services.conversation.access.issue": { params: access, result: grant },
  "native.services.conversation.desktop.take": {
    params: empty,
    result: z
      .array(
        z.strictObject({
          id: z.string(),
          action: z.string(),
          input: JsonObjectSchema,
          cwd: z.string(),
          sessionId: z.string(),
          environmentId: z.string(),
          deadline: SafeCounterSchema,
        }),
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
    result: z.strictObject({ formatted: z.string(), cursorOffset: SafeCounterSchema }).nullable(),
  },
} as const;
export type NativeServiceMethod = keyof typeof NATIVE_SERVICES_RPC_SCHEMAS;
export const NATIVE_SERVICE_METHODS = Object.freeze(
  Object.keys(NATIVE_SERVICES_RPC_SCHEMAS) as NativeServiceMethod[],
);
export function nativeServiceReadOnly(method: NativeServiceMethod): boolean {
  return (
    method.endsWith(".bridge.describe") ||
    method.endsWith(".desktop.authorize") ||
    method.endsWith(".native.status")
  );
}
