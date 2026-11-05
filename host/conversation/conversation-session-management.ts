import { z } from "zod";
import {
  CommandDispatchParamsSchema,
  ContextualSessionInputSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
  type SessionCommand,
} from "../../src/shared/model/host-contracts/session-commands";
import type { HostSession, RemoteAttachment } from "../../src/features/connections/model/protocol";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";

const identity = z.string().min(1).max(300);
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const modelSettings = z
  .record(z.string().max(64), z.string().max(128))
  .refine((value) => Object.keys(value).length <= 20);
const contextual = ContextualSessionInputSchema.extend({
  sessionId: identity,
  sourceBlockId: identity,
  expectedRevision: revision,
  mode: z.literal("handoff"),
  model: z.string().min(1).max(200),
  modelSettings,
});
const schemas = {
  "sessions.configuration": z.strictObject({ sessionId: identity }),
  "sessions.configure": z.strictObject({
    requestId: identity,
    sessionId: identity,
    expectedRevision: revision,
    harness: SessionProviderSchema.optional(),
    providerAccountId: identity.nullable().optional(),
    model: z.string().min(1).max(200),
    modelSettings,
    runtimeMode: SessionRuntimeModeSchema,
  }),
  "sessions.contextual.preview": contextual,
  "sessions.contextual.create": contextual.extend({
    requestId: identity,
    previewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  "sessions.draft": z.strictObject({
    requestId: identity,
    sessionId: identity,
    expectedRevision: revision,
    text: z.string().max(12_000),
    attachmentIds: z.array(identity).max(20).optional(),
  }),
};
export type SessionManagementAction = keyof typeof schemas;
// JSON Schema cannot express the bounded-map refinement; call() repeats full validation.
const settingsJson = { type: "object", additionalProperties: { type: "string", maxLength: 128 } };
const text = { type: "string", minLength: 1, maxLength: 300 };
const integer = { type: "integer", minimum: 0 };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const contextualFields = {
  sessionId: text,
  sourceBlockId: text,
  expectedRevision: integer,
  mode: { enum: ["handoff"] },
  harness: { enum: SessionProviderSchema.options },
  model: text,
  modelSettings: settingsJson,
};
export const SESSION_MANAGEMENT_TOOLS = {
  "sessions.configuration": object({ sessionId: text }, ["sessionId"]),
  "sessions.configure": object(
    {
      requestId: text,
      sessionId: text,
      expectedRevision: integer,
      harness: { enum: SessionProviderSchema.options },
      providerAccountId: { type: ["string", "null"] },
      model: text,
      modelSettings: settingsJson,
      runtimeMode: { enum: SessionRuntimeModeSchema.options },
    },
    ["requestId", "sessionId", "expectedRevision", "model", "modelSettings", "runtimeMode"],
  ),
  "sessions.contextual.preview": object(contextualFields, Object.keys(contextualFields)),
  "sessions.contextual.create": object(
    { ...contextualFields, requestId: text, previewDigest: text },
    [...Object.keys(contextualFields), "requestId", "previewDigest"],
  ),
  "sessions.draft": object(
    {
      requestId: text,
      sessionId: text,
      expectedRevision: integer,
      text: { type: "string", maxLength: 12_000 },
      attachmentIds: { type: "array", maxItems: 20, items: text },
    },
    ["requestId", "sessionId", "expectedRevision", "text"],
  ),
} as const;
export const SESSION_MANAGEMENT_READS = new Set<string>([
  "sessions.configuration",
  "sessions.contextual.preview",
]);
export const isSessionManagementAction = (action: string): action is SessionManagementAction =>
  Object.hasOwn(schemas, action);
export function describeSessionManagementTool(action: string) {
  if (action === "sessions.configuration")
    return "Read the exact session provider, model, permission mode and revision. Selection is not provider authentication or entitlement.";
  if (action === "sessions.configure")
    return "Change the exact session provider/model/permission mode after native owner approval, using the revision from sessions.configuration. Preserves existing provider, account and busy-turn gates; never starts a turn.";
  if (action === "sessions.contextual.preview")
    return "Preview a handoff from a completed reply to another provider. Returns a digest of the exact outgoing context. No session is created and no provider turn starts.";
  if (action === "sessions.contextual.create")
    return "Create an unsent handoff using the reviewed source revision and previewDigest, after native owner approval. Existing managed-workspace policy applies. Does not start the destination provider.";
  if (action === "sessions.draft")
    return "Add an unsent draft after native owner approval and exact revision check. Optional attachmentIds must already belong to accepted user messages in this same session; no paths, bytes, upload grants or arbitrary files. Host-unavailable attachment files fail explicitly.";
  return undefined;
}

export type SessionManagementPorts = {
  session(id: string): Promise<HostSession>;
  preview(input: Record<string, unknown>, source: HostSession): Promise<unknown>;
  /** Must retain configure/draft expectedRevision in the engine's atomic admission. */
  dispatch(command: SessionCommand): Promise<unknown>;
};

/** Called behind ConversationManagementTools' exact-operation approval and durable receipts. */
export async function dispatchSessionManagement(
  action: SessionManagementAction,
  raw: Record<string, unknown>,
  principal: RuntimeLogSubjectPrincipal,
  authorized: () => Promise<boolean>,
  ports: SessionManagementPorts,
) {
  const check = async () => {
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
  };
  await check();
  const input = schemas[action].parse(raw);
  const source = await ports.session(input.sessionId);
  await check();
  if (source.projectId !== principal.projectId || source.session.id !== input.sessionId)
    throw new Error("Conversation belongs to another project.");
  if (action === "sessions.configuration")
    return {
      sessionId: source.session.id,
      revision: source.revision,
      authorityGeneration: source.authorityGeneration ?? null,
      status: source.status,
      harness: source.session.harness,
      model: source.session.model,
      modelSettings: source.session.modelSettings ?? {},
      providerAccountId: source.session.providerAccountId ?? null,
      runtimeMode: source.session.runtimeMode,
    };
  if (!("expectedRevision" in input) || source.revision !== input.expectedRevision)
    throw new Error("The conversation changed. Read it again before continuing.");
  if (action === "sessions.contextual.preview") {
    const result = await ports.preview(input, source);
    await check();
    return result;
  }
  if (!("requestId" in input)) throw new Error("Session management request ID required.");
  const { requestId, ...fields } = input;
  let command: unknown;
  if (action === "sessions.configure")
    command = { ...fields, type: "configure", commandId: requestId };
  else if (action === "sessions.contextual.create")
    command = { ...fields, type: "contextual", commandId: requestId };
  else {
    const draft = schemas["sessions.draft"].parse(input);
    const ids = draft.attachmentIds ?? [];
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate draft attachment ID.");
    const attachments: RemoteAttachment[] = ids.map((id) => {
      const attachment = source.session.blocks
        .filter((block) => block.role === "user" && !block.draft && !block.internal)
        .flatMap((block) => block.attachments ?? [])
        .find((file) => file.id === id);
      if (!attachment || attachment.missing)
        throw new Error("Draft attachment is not an accepted file in this conversation.");
      return {
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
        ...(attachment.browserAnnotation
          ? { browserAnnotation: attachment.browserAnnotation }
          : {}),
      };
    });
    command = {
      type: "draft",
      commandId: requestId,
      sessionId: input.sessionId,
      expectedRevision: draft.expectedRevision,
      text: draft.text,
      ...(attachments.length ? { attachments } : {}),
    };
  }
  await check();
  const result = await ports.dispatch(
    CommandDispatchParamsSchema.parse({
      ...(command as Record<string, unknown>),
      ...(source.authorityGeneration !== undefined
        ? { authorityGeneration: source.authorityGeneration }
        : {}),
    }),
  );
  await check();
  return result;
}
