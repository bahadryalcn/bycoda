import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { SessionMessageAuthor } from "../../src/features/sessions/model/session";
import type { RuntimeLogSubjectPrincipal } from "../execution/runtime-log-tools";
import type { SessionQueues } from "../sessions/session-queue";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

const identity = z.string().min(1).max(200);
const fields = {
  requestId: identity,
  sessionId: identity,
};
const schemas = {
  "sessions.message": z.strictObject({
    ...fields,
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    text: z
      .string()
      .min(1)
      .max(12_000)
      .refine((value) => !!value.trim()),
  }),
  "sessions.cancel": z.strictObject({ ...fields, runId: identity }),
};
export type SessionControlAction = keyof typeof schemas;
export const SESSION_CONTROL_TOOLS = {
  "sessions.message": z.toJSONSchema(schemas["sessions.message"], { unrepresentable: "any" }),
  "sessions.cancel": z.toJSONSchema(schemas["sessions.cancel"]),
};
export const isSessionControlAction = (action: string): action is SessionControlAction =>
  Object.hasOwn(schemas, action);
export function describeSessionControlTool(action: string) {
  if (action === "sessions.message")
    return "Request owner approval to queue this exact message to another conversation in the same project. Read sessions.configuration for expectedRevision first. Preserves drafts, queue pauses and leases. Queued is not delivered. Does not enroll the conversation in Assistant supervision or grant future writes. Keep requestId for receipt reconciliation; never resend an uncertain operation with a fresh ID.";
  if (action === "sessions.cancel")
    return "Request owner approval to stop another conversation's exact current run in the same project. Read sessions.configuration for runId first. Refuses changed runs and conversations owned by tasks, crews or other supervisors. Does not clear drafts or queued messages. Keep requestId for receipt reconciliation.";
  return undefined;
}
export type SessionControlPorts = {
  session(id: string): Promise<HostSession>;
  queues: Pick<SessionQueues, "get" | "change">;
  owned(id: string): Promise<boolean>;
  cancel(target: HostSession, commandId: string, check: () => Promise<void>): Promise<unknown>;
};

/** Runs behind exact native approval and the management receipt. Never grants future control. */
export async function dispatchSessionControl(
  action: SessionControlAction,
  raw: Record<string, unknown>,
  principal: RuntimeLogSubjectPrincipal,
  authorized: () => Promise<boolean>,
  ports: SessionControlPorts,
) {
  const input = schemas[action].parse(raw);
  if (principal.kind === "session" && principal.sessionId === input.sessionId)
    throw new Error("Use the current conversation's own controls.");
  const check = async () => {
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
    const target = await ports.session(input.sessionId);
    if (target.projectId !== principal.projectId || target.session.id !== input.sessionId)
      throw new Error("Conversation belongs to another project.");
    if ("expectedRevision" in input && target.revision !== input.expectedRevision)
      throw new Error("The conversation changed. Read it again before continuing.");
    if (
      target.managedBy ||
      target.session.orchestrationLeadId ||
      target.session.inboxAsk ||
      target.session.managedBy ||
      (await ports.owned(input.sessionId))
    )
      throw new Error("This conversation requires its existing work owner.");
    if (
      action === "sessions.cancel" &&
      (target.status !== "running" ||
        target.runId !== schemas["sessions.cancel"].parse(input).runId)
    )
      throw new Error("The exact conversation run changed.");
    if (!(await authorized())) throw new Error("Conversation authority revoked.");
    return target;
  };
  const target = await check();
  const commandId = `session_control_${createHash("sha256")
    .update(
      JSON.stringify([
        principal.projectId,
        principal.kind === "session"
          ? ["session", principal.sessionId]
          : ["thread", principal.threadId],
        input.requestId,
        action,
      ]),
    )
    .digest("hex")}`;
  if (action === "sessions.cancel")
    return ports.cancel(target, commandId, async () => {
      await check();
    });

  const { text } = schemas["sessions.message"].parse(input);
  const sender =
    principal.kind === "session" ? await ports.session(principal.sessionId) : undefined;
  if (sender && sender.projectId !== principal.projectId)
    throw new Error("Conversation belongs to another project.");
  const senderName = truncateGraphemes(sender?.session.title || "", 200);
  const author: SessionMessageAuthor =
    principal.kind === "session"
      ? {
          kind: "conversation",
          id: principal.sessionId,
          name: senderName && senderName.length <= 200 ? senderName : principal.sessionId,
          reason: "message",
          operationId: input.requestId,
        }
      : {
          kind: "assistant-room",
          threadId: principal.threadId,
          name: "Assistant",
          reason: "message",
          operationId: input.requestId,
        };
  const before = await ports.queues.get(input.sessionId);
  if (before.messages.some((row) => row.id === commandId))
    return { state: "queued", sessionId: input.sessionId, messageId: commandId };
  await check();
  await ports.queues.change(input.sessionId, before, {
    ...before,
    status: before.status ?? "active",
    messages: [
      ...before.messages,
      {
        id: commandId,
        text,
        attachments: [],
        author,
        ...(target.authorityGeneration !== undefined
          ? { authorityGeneration: target.authorityGeneration }
          : {}),
        modelTarget: {
          harness: target.session.harness,
          model: target.session.model,
          modelSettings: target.session.modelSettings ?? {},
          ...(target.session.providerAccountId
            ? { providerAccountId: target.session.providerAccountId }
            : {}),
        },
      },
    ],
  });
  return { state: "queued", sessionId: input.sessionId, messageId: commandId };
}
