import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AssistantObservation,
  AssistantObservationJournal,
} from "./assistant-observation-journal";
import type { RoomManagementAdmission } from "../management/assistant-management-turn";

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim() === value);
const scopeSchema = z.union([
  z.strictObject({ projectId: id }),
  z.strictObject({ accountId: id }),
  z.strictObject({ nativeInstallationId: id }),
  z.strictObject({ hostLibrary: z.literal(true) }),
]);
const sourceSchema = z.enum([
  "task",
  "session",
  "native-session",
  "goal",
  "note",
  "server",
  "crew",
]);
const sourceProperty = {
  type: "string",
  enum: ["task", "session", "native-session", "goal", "note", "server", "crew"],
} as const;
const nativeLibraryProperty = { type: "boolean", enum: [true] } as const;
type Scope = z.infer<typeof scopeSchema>;
export const OBSERVATION_TOOL_SCHEMAS = {
  "observations.read": {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 100 },
      source: sourceProperty,
      nativeLibrary: nativeLibraryProperty,
    },
    required: [],
    additionalProperties: false,
  },
  "observations.ack": {
    type: "object",
    properties: {
      cursor: { type: "integer", minimum: 0 },
      source: sourceProperty,
      nativeLibrary: nativeLibraryProperty,
    },
    required: ["cursor"],
    additionalProperties: false,
  },
  "observations.resnapshot": {
    type: "object",
    properties: {
      offset: { type: "integer", minimum: 0, maximum: 100000 },
      snapshotId: { type: "string", minLength: 1, maxLength: 200 },
      source: sourceProperty,
      nativeLibrary: nativeLibraryProperty,
    },
    required: [],
    additionalProperties: false,
  },
} as const;
const readInput = z.strictObject({
  limit: z.number().int().min(1).max(100).optional(),
  source: sourceSchema.optional(),
  nativeLibrary: z.literal(true).optional(),
});
const ackInput = z.strictObject({
  cursor: z.number().int().nonnegative().safe(),
  source: sourceSchema.optional(),
  nativeLibrary: z.literal(true).optional(),
});
const snapshotInput = z.strictObject({
  offset: z.number().int().min(0).max(100000).optional(),
  snapshotId: id.optional(),
  source: sourceSchema.optional(),
  nativeLibrary: z.literal(true).optional(),
});
export type ObservationToolPorts = {
  journal: AssistantObservationJournal;
  /** Host-derived grant generation isolates cursors across revoke and regrant. */
  consumerGeneration?: string;
  /** Injected by trusted live Native capture, never by model input. */
  nativeInstallationId?: string;
  /** Verified live Native source coverage, not a Host journal cursor. */
  nativeSourceGap?(scope: Scope, source: z.infer<typeof sourceSchema>): Promise<boolean>;
  /** Resolves the real source thread and the current project/account privacy gate. */
  authorizeScope(
    threadId: string,
    scope: Scope,
    admission: RoomManagementAdmission,
  ): Promise<boolean>;
  authorizeEvent(
    threadId: string,
    scope: Scope,
    event: AssistantObservation,
    admission: RoomManagementAdmission,
  ): Promise<boolean>;
  /** Captured live authority generation; this function must not perform I/O. */
  guard(threadId: string, scope: Scope, admission: RoomManagementAdmission): () => boolean;
  /** Canonical bounded read, with completeness asserted by its owning source. */
  resnapshot(
    threadId: string,
    scope: Scope,
    admission: RoomManagementAdmission,
    offset: number,
    snapshotId: string | undefined,
    consumer: string,
    source?: z.infer<typeof sourceSchema>,
  ): Promise<{ complete: boolean; value: unknown }>;
};
export function isAssistantObservationAction(
  action: string,
): action is keyof typeof OBSERVATION_TOOL_SCHEMAS {
  return Object.hasOwn(OBSERVATION_TOOL_SCHEMAS, action);
}
export function observationRoomConsumer(
  threadId: string,
  generation?: string,
  source?: z.infer<typeof sourceSchema>,
) {
  return `room:${createHash("sha256")
    .update(
      source
        ? JSON.stringify([threadId, generation ?? null, source])
        : generation
          ? JSON.stringify([threadId, generation])
          : threadId,
    )
    .digest("hex")}`;
}
export function validateAssistantObservationInput(
  action: string,
  input: Record<string, unknown>,
): void {
  if (action === "observations.read") readInput.parse(input);
  else if (action === "observations.ack") ackInput.parse(input);
  else if (action === "observations.resnapshot") snapshotInput.parse(input);
  else throw new Error("Unknown observation action.");
}
export async function executeAssistantObservationTool(
  ports: ObservationToolPorts,
  call: {
    threadId: string;
    projectId?: string;
    accountId?: string;
    action: string;
    input: Record<string, unknown>;
  },
  admission: RoomManagementAdmission,
) {
  if (!id.safeParse(call.threadId).success || !isAssistantObservationAction(call.action))
    throw new Error("Invalid observation source or action.");
  const parsed =
    call.action === "observations.read"
      ? readInput.parse(call.input)
      : call.action === "observations.ack"
        ? ackInput.parse(call.input)
        : snapshotInput.parse(call.input);
  if (
    parsed.nativeLibrary &&
    (!ports.nativeInstallationId || !ports.consumerGeneration || call.projectId || call.accountId)
  )
    throw new Error("Native library capture is unavailable or ambiguous.");
  const source = parsed.source;
  if (
    source === "native-session" &&
    (!call.projectId || !ports.nativeInstallationId || !ports.consumerGeneration)
  )
    throw new Error("Native session source capture is unavailable.");
  const scope = scopeSchema.parse({
    ...(call.projectId ? { projectId: call.projectId } : {}),
    ...(call.accountId ? { accountId: call.accountId } : {}),
    ...(parsed.nativeLibrary
      ? source === "crew"
        ? { hostLibrary: true }
        : { nativeInstallationId: ports.nativeInstallationId }
      : {}),
  });
  if (
    source &&
    !("projectId" in scope) &&
    !("nativeInstallationId" in scope) &&
    !("hostLibrary" in scope)
  )
    throw new Error("Source-qualified observations require an authorized source scope.");
  if (
    ("projectId" in scope &&
      source &&
      !["task", "session", "native-session", "goal"].includes(source)) ||
    ("nativeInstallationId" in scope && (!source || !["note", "server"].includes(source))) ||
    ("hostLibrary" in scope && source !== "crew")
  )
    throw new Error("Observation source is unavailable in this scope.");
  // The request cannot select or impersonate a consumer: Room thread identity owns the cursor.
  const consumer = observationRoomConsumer(call.threadId, ports.consumerGeneration, source);
  const guard = ports.guard(call.threadId, scope, admission);
  const authorized = async () =>
    !admission.signal?.aborted &&
    (await admission.authorized()) &&
    (await ports.authorizeScope(call.threadId, scope, admission));
  const eventAuthorized = async (event: AssistantObservation) =>
    (await authorized()) && (await ports.authorizeEvent(call.threadId, scope, event, admission));
  const live = () => !admission.signal?.aborted && guard();
  const nativeGap = async () => {
    if (
      !("nativeInstallationId" in scope) &&
      !("hostLibrary" in scope) &&
      source !== "native-session"
    )
      return false;
    if (!source || !ports.nativeSourceGap || !(await authorized()) || !live())
      throw new Error("Native observation source status is unavailable.");
    const gap = await ports.nativeSourceGap(scope, source);
    if (!(await authorized()) || !live())
      throw new Error("Native observation source status changed.");
    return gap;
  };
  if (call.action === "observations.read") {
    if (await nativeGap())
      return { status: "source-gap" as const, observationSource: source, events: [] };
    const result = await ports.journal.read(
      consumer,
      scope,
      authorized,
      eventAuthorized,
      live,
      Math.min((parsed as z.infer<typeof readInput>).limit ?? 3, 3),
      3000,
      source,
      source === "native-session" ? ports.nativeInstallationId : undefined,
    );
    if ("projectId" in scope)
      return {
        ...result,
        ...(source ? { observationSource: source } : {}),
        events: result.events.map(({ accountId: _accountId, ...event }) => ({
          ...event,
          projectIds: [scope.projectId],
        })),
      };
    return { ...result, ...(source ? { observationSource: source } : {}) };
  }
  if (call.action === "observations.ack") {
    if (await nativeGap()) throw new Error("Native observation source requires resnapshot.");
    return await ports.journal
      .acknowledge(consumer, scope, (parsed as z.infer<typeof ackInput>).cursor, authorized, live)
      .then(() => ({ acknowledged: true, ...(source ? { observationSource: source } : {}) }));
  }
  const sourceGap = await nativeGap();
  const current = await ports.journal.inspectCursor(consumer, scope, authorized, live);
  const oversized =
    current.status === "ok" && !sourceGap
      ? await ports.journal.inspectOversized(
          consumer,
          scope,
          authorized,
          eventAuthorized,
          live,
          3000,
          source,
          source === "native-session" ? ports.nativeInstallationId : undefined,
          true,
        )
      : undefined;
  if (current.status !== "gap" && !oversized && !sourceGap)
    throw new Error("Resnapshot is available only after a retention gap or oversized observation.");
  if (!(await authorized()) || !live())
    throw new Error("Observation source is unavailable or revoked.");
  const snapshotOptions = parsed as z.infer<typeof snapshotInput>;
  const snapshot = await ports.resnapshot(
    call.threadId,
    scope,
    admission,
    snapshotOptions.offset ?? 0,
    snapshotOptions.snapshotId,
    consumer,
    source,
  );
  if (source && snapshot.complete) {
    const value = snapshot.value;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !Array.isArray((value as { coverage?: unknown }).coverage) ||
      (value as { coverage: unknown[] }).coverage.length !== 1 ||
      (value as { coverage: unknown[] }).coverage[0] !== source ||
      (value as { pagesDelivered?: unknown }).pagesDelivered !== true
    )
      throw new Error("Observation source baseline coverage is incomplete.");
  }
  const serialized = JSON.stringify(snapshot.value);
  if (
    !snapshot.complete ||
    typeof serialized !== "string" ||
    Buffer.byteLength(serialized, "utf8") > 3000
  )
    return {
      state: "incomplete",
      ...(source ? { observationSource: source } : {}),
      ...(current.status === "gap" ? { retainedAfter: current.retainedAfter } : {}),
      ...(typeof serialized === "string" && Buffer.byteLength(serialized, "utf8") <= 3000
        ? { snapshot: snapshot.value }
        : {}),
      reason: "Snapshot is incomplete or exceeds the safe response budget.",
    };
  if (!(await authorized()) || !live())
    throw new Error("Observation source is unavailable or revoked.");
  const cursor = oversized
    ? await ports.journal.completeOversizedRecovery(
        consumer,
        scope,
        oversized,
        authorized,
        eventAuthorized,
        live,
        source,
        source === "native-session" ? ports.nativeInstallationId : undefined,
      )
    : current.status === "gap"
      ? await ports.journal.resumeAfterResnapshot(
          consumer,
          scope,
          current.retainedAfter,
          authorized,
          live,
        )
      : current.cursor;
  return {
    state: "resnapshotted",
    ...(source ? { observationSource: source } : {}),
    cursor,
    snapshot: snapshot.value,
  };
}
