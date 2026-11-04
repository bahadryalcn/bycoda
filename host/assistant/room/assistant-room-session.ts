import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostEngine } from "../../engine";
import type { HostStore } from "../../store";
import type { CommandReceipt, HostSession } from "../../../src/features/connections/model/protocol";
import {
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "../../../src/shared/model/host-contracts/session-commands";

const id = z.string().min(1).max(200);
const revision = z.number().int().nonnegative().safe();
const schemas = {
  "sessions.create": z.strictObject({
    requestId: id,
    harness: SessionProviderSchema,
    model: id,
    modelSettings: z
      .record(z.string().max(64), z.string().max(128))
      .refine((value) => Object.keys(value).length <= 20),
    runtimeMode: SessionRuntimeModeSchema,
  }),
  "sessions.submit": z.strictObject({
    requestId: id,
    sessionId: id,
    expectedRevision: revision,
    text: z
      .string()
      .min(1)
      .max(16000)
      .refine((value) => value.trim().length > 0),
  }),
  "sessions.submit.status": z.strictObject({ sessionId: id, submissionId: id }),
  "sessions.stop": z.strictObject({ requestId: id, sessionId: id, runId: id }),
};
export type RoomSessionAction = keyof typeof schemas;
export const isRoomSessionAction = (action: string): action is RoomSessionAction =>
  Object.hasOwn(schemas, action);
const string = { type: "string", minLength: 1, maxLength: 200 };
const object = (properties: Record<string, unknown>, required: string[]) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const ROOM_SESSION_TOOLS = {
  "sessions.create": object(
    {
      requestId: string,
      harness: { enum: SessionProviderSchema.options },
      model: string,
      modelSettings: { type: "object", additionalProperties: { type: "string", maxLength: 128 } },
      runtimeMode: { enum: SessionRuntimeModeSchema.options },
    },
    ["requestId", "harness", "model", "modelSettings", "runtimeMode"],
  ),
  "sessions.submit": object(
    {
      requestId: string,
      sessionId: string,
      expectedRevision: { type: "integer", minimum: 0 },
      text: { type: "string", minLength: 1, maxLength: 16000 },
    },
    ["requestId", "sessionId", "expectedRevision", "text"],
  ),
  "sessions.submit.status": object({ sessionId: string, submissionId: string }, [
    "sessionId",
    "submissionId",
  ]),
  "sessions.stop": object({ requestId: string, sessionId: string, runId: string }, [
    "requestId",
    "sessionId",
    "runId",
  ]),
} as const;
export function validateRoomSessionAction(
  action: RoomSessionAction,
  raw: Record<string, unknown>,
  requestId: string,
) {
  const input = schemas[action].parse(raw);
  if ("requestId" in input && input.requestId !== requestId)
    throw new Error("Room session operation identity changed.");
  return input;
}
export function describeRoomSessionTool(action: string) {
  if (!isRoomSessionAction(action)) return;
  return "Manage a canonical Host conversation in the explicitly targeted project from this Room. Creation is unsent and needs explicit execution settings. Submit needs explicit user intent, the current session revision and an idle session without a draft; exact native review is required. Stop targets the exact run. Native desktop sessions use a separate owner and are never substituted. Accepted means durable Host ownership, not finished work. Inspect submit.status with the original submissionId after an uncertain acknowledgement; absence remains unknown.";
}
type Source = { kind: "assistant-thread"; threadId: string; projectId: string; name: string };
export const roomSessionCommandId = (
  source: Pick<Source, "threadId" | "projectId">,
  requestId: string,
  action: RoomSessionAction = "sessions.submit",
) =>
  `room-session-${createHash("sha256")
    .update(JSON.stringify([source.threadId, source.projectId, action, requestId]))
    .digest("hex")}`;

/** Runs only inside exact native review/receipt and a live project permit.
 * The Engine command transaction owns revision/idle checks and accepted run
 * transfer. Provider work then belongs to that exact canonical run, not voice.
 */
export async function executeRoomSessionAction(
  action: RoomSessionAction,
  raw: Record<string, unknown>,
  source: Source,
  authorized: () => Promise<boolean>,
  store: HostStore,
  engine: Pick<HostEngine, "command" | "withCommandAdmission" | "withMessageAuthor">,
) {
  const input = schemas[action].parse(raw);
  const check = async () => {
    if (!(await authorized())) throw new Error("Room session authority revoked.");
  };
  await check();
  const target = async (sessionId: string): Promise<HostSession> => {
    const session = await store.session(sessionId);
    if (session.projectId !== source.projectId || session.session.id !== sessionId)
      throw new Error("The conversation belongs to another project.");
    // `desktop` is transcript sync provenance, not an execution-owner lease.
    // Fresh Host sessions are shared with desktop from creation. The Engine's
    // canonical lease admission still rejects an active native desktop writer.
    if (session.executionOwner === "desktop")
      throw new Error("This conversation requires its native desktop owner.");
    return session;
  };
  if (action === "sessions.submit.status") {
    const value = schemas["sessions.submit.status"].parse(raw);
    await target(value.sessionId);
    const commandId = roomSessionCommandId(source, value.submissionId);
    const receipt = await store.receiptStatus(commandId);
    await check();
    if (receipt && receipt.sessionId !== value.sessionId)
      throw new Error("Submission belongs to another conversation.");
    return receipt
      ? { state: "accepted", submissionId: value.submissionId, ...receipt }
      : { state: "unknown", submissionId: value.submissionId, sessionId: value.sessionId };
  }
  if (!("requestId" in input)) throw new Error("Room session requestId required.");
  const commandId = roomSessionCommandId(source, input.requestId, action);
  let accepted: CommandReceipt | undefined;
  const admit = async (stage: {
    phase: "command" | "provider";
    sessionId: string;
    runId?: string;
  }) => {
    if (stage.phase === "provider") {
      const expectedRun =
        action === "sessions.stop" ? schemas["sessions.stop"].parse(raw).runId : accepted?.runId;
      if (
        !accepted ||
        !expectedRun ||
        accepted.sessionId !== stage.sessionId ||
        expectedRun !== stage.runId
      )
        throw new Error("The accepted Room run changed.");
      // The Engine independently checks canonical execution authority. A later
      // voice close must not revoke work that the Host has durably accepted.
      await target(stage.sessionId);
      return;
    }
    await check();
    if (!("sessionId" in input)) return;
    const session = await target(input.sessionId);
    if (action === "sessions.submit") {
      const value = schemas["sessions.submit"].parse(raw);
      if (
        session.revision !== value.expectedRevision ||
        session.status === "running" ||
        session.session.blocks.some((block) => block.draft)
      )
        throw new Error("The conversation changed, is busy or has an unsent draft.");
      if (session.managedBy || session.session.orchestrationLeadId || session.session.inboxAsk)
        throw new Error("This conversation requires its existing work owner.");
    } else if (action === "sessions.stop") {
      const value = schemas["sessions.stop"].parse(raw);
      if (session.status !== "running" || session.runId !== value.runId)
        throw new Error("The exact conversation run changed.");
    }
    await check();
  };
  const work = () => {
    if (action === "sessions.create") {
      const value = schemas["sessions.create"].parse(raw);
      return engine.command({
        type: "create",
        commandId,
        projectId: source.projectId,
        harness: value.harness,
        model: value.model,
        modelSettings: value.modelSettings,
        runtimeMode: value.runtimeMode,
      });
    }
    if (action === "sessions.submit") {
      const value = schemas["sessions.submit"].parse(raw);
      return engine.command({
        type: "send",
        commandId,
        sessionId: value.sessionId,
        text: value.text,
      });
    }
    const value = schemas["sessions.stop"].parse(raw);
    return engine.command({
      type: "cancel",
      commandId,
      sessionId: value.sessionId,
      runId: value.runId,
    });
  };
  const receipt = await engine.withCommandAdmission(
    {
      check: admit,
      onAccepted: async (receipt) => {
        accepted = receipt;
      },
    },
    () =>
      engine.withMessageAuthor(
        {
          kind: "assistant-room",
          name: source.name,
          threadId: source.threadId,
          reason: "kickoff",
          operationId: input.requestId,
        },
        work,
      ),
  );
  await check();
  return { state: "accepted", requestId: input.requestId, ...receipt };
}
