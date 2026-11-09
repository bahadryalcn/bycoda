import { z } from "zod";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { Session } from "../../src/features/sessions/model/session";
import {
  NativeFenceEvidenceSchema,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import {
  ModelSettingsSchema,
  SessionProviderSchema,
  SessionRuntimeModeSchema,
} from "../../src/shared/model/host-contracts/session-commands";
import { ConversationHeadSchema } from "../../src/shared/model/host-contracts/session-reads";
import {
  IdentifierSchema,
  JsonObjectSchema,
  JsonValueSchema,
  SafeCounterSchema,
  type JsonObject,
  type JsonValue,
} from "../../src/shared/model/host-contracts/schemas";
import type { AuthoritySnapshotConverter } from "./authority-coordinator";

export const NATIVE_SNAPSHOT_CONVERTER_VERSION = "native-session-target/v1";
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_NODES = 1_000_000;
const MAX_DEPTH = 128;
const text = z.string();
const digest = text.regex(/^[a-f0-9]{64}(?![\s\S])/);
const head = ConversationHeadSchema.extend({ chain: digest });
const divergence = z.strictObject({
  key: text.min(1),
  keep: z.literal(true).optional(),
  hostHead: head.optional(),
});
const linked = z.strictObject({
  kind: z.enum(["issue", "pr"]),
  repo: text,
  number: SafeCounterSchema,
  url: text,
});
const rewind = z.strictObject({
  id: text.min(1),
  createdAt: SafeCounterSchema,
  fromBlockId: text.min(1),
  blocks: z.array(JsonObjectSchema),
});

const NativeSessionRecordSchema = z.strictObject({
  managedBy: z
    .union([
      z.strictObject({
        assistant: z.literal(true),
        jobId: IdentifierSchema,
        managedAt: SafeCounterSchema,
      }),
      z.strictObject({
        assistant: z.literal(true),
        supervisionId: IdentifierSchema,
        managedAt: SafeCounterSchema,
      }),
    ])
    .optional(),
  transcriptRevision: SafeCounterSchema.optional(),
  orchestrationLeadId: text.optional(),
  id: IdentifierSchema,
  cwd: text.min(1),
  harness: SessionProviderSchema,
  model: text,
  modelSettings: ModelSettingsSchema,
  runtimeMode: SessionRuntimeModeSchema,
  title: text,
  providerSessionId: text.optional(),
  providerAccountId: text.optional(),
  blocks: z.array(JsonObjectSchema),
  contextUsed: SafeCounterSchema.optional(),
  contextWindow: SafeCounterSchema.optional(),
  branch: text.optional(),
  worktreeCwd: text.optional(),
  workspaceMode: z.enum(["current", "worktree"]).optional(),
  workspaceId: IdentifierSchema.optional(),
  workspaceRevision: SafeCounterSchema.optional(),
  worktreeRemoved: z.boolean(),
  linkedWorkItem: linked.optional(),
  automationId: text.optional(),
  rewindHistory: z.array(rewind).optional(),
  pendingContextReplay: text.optional(),
  adoptedDivergence: text.optional(),
  adoptedBase: text.optional(),
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
});
type NativeRecord = z.infer<typeof NativeSessionRecordSchema>;
const recordProjection = NativeSessionRecordSchema.omit({ blocks: true });
const blob = z.strictObject({ encoding: z.literal("base64"), bytes: text });
const cell = z.union([z.null(), text, z.number().finite(), blob]);
const row = z.record(text.regex(/^[A-Za-z_][A-Za-z0-9_]*(?![\s\S])/), cell);
const tables = [
  "sessions",
  "session_blocks",
  "session_block_state",
  "composer_drafts",
  "session_queues",
  "in_flight_sessions",
  "orchestration_runs",
  "orchestration_sidebar",
  "orchestration_workers",
  "session_rewind_operations",
  "native_managed_turns",
  "native_rewind_requests",
  "native_rewind_intents",
] as const;
type Table = (typeof tables)[number];
const retainedRows = z.strictObject(
  Object.fromEntries(tables.map((name) => [name, z.array(row)])) as Record<
    Table,
    z.ZodArray<typeof row>
  >,
);
const NativeSourceSchema = z.strictObject({
  session: NativeSessionRecordSchema,
  clientOwnedQueue: JsonValueSchema,
  clientOwnedDraftJson: text.nullable(),
  retainedNativeRows: retainedRows,
});
type NativeSource = z.infer<typeof NativeSourceSchema>;
type SqlRow = z.infer<typeof row>;

const publicSession = NativeSessionRecordSchema.omit({
  transcriptRevision: true,
  contextUsed: true,
  contextWindow: true,
  adoptedDivergence: true,
  adoptedBase: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  context: z
    .strictObject({ used: SafeCounterSchema, window: SafeCounterSchema.optional() })
    .optional(),
  adoptedDivergence: divergence.optional(),
  adoptedBase: head.optional(),
});
const hostProjection = z.strictObject({
  session: publicSession,
  projectId: IdentifierSchema,
  revision: SafeCounterSchema,
  authorityGeneration: SafeCounterSchema.min(1),
  status: z.literal("idle"),
  createdAt: SafeCounterSchema,
  updatedAt: SafeCounterSchema,
  archived: z.boolean(),
  pinned: z.boolean(),
});
const preservation = z.strictObject({
  version: z.literal(1),
  environmentId: IdentifierSchema,
  sourceProfileId: IdentifierSchema,
  sourceStoreId: IdentifierSchema,
  sessionId: IdentifierSchema,
  migrationId: IdentifierSchema,
  sourceDigest: digest,
  sourceRevision: SafeCounterSchema,
  clientOwnedQueue: JsonValueSchema,
  clientOwnedDraftJson: text.nullable(),
  retainedNativeRows: retainedRows,
  recordProjection,
});

/** Private journal target. Never serialize this envelope as a public HostSession. */
export const NativeMigrationTargetSchema = z.strictObject({
  version: z.literal(1),
  kind: z.literal("native-session-target"),
  hostSession: hostProjection,
  nativePreservation: preservation,
});
export type NativeMigrationTarget = Omit<
  z.infer<typeof NativeMigrationTargetSchema>,
  "hostSession"
> & { hostSession: HostSession };
export type NativeSnapshotConverterOptions = { projectId: string; expectedCwd: string };
export class NativeSnapshotConversionError extends Error {
  readonly code = "NATIVE_SNAPSHOT_CONVERSION_BLOCKED";
  constructor(reason: string) {
    super(reason);
    this.name = "NativeSnapshotConversionError";
  }
}
function blocked(reason: string): never {
  throw new NativeSnapshotConversionError(reason);
}

/** Inspect descriptors before JSON/Zod can execute getters or omit unsupported data. */
function boundedJson(value: unknown): asserts value is JsonValue {
  const pending = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++count > MAX_NODES || next.depth > MAX_DEPTH)
      blocked("Snapshot exceeds structural bounds");
    const item = next.value;
    if (item === null || typeof item === "boolean") continue;
    if (typeof item === "string") {
      if (Buffer.from(item, "utf8").toString("utf8") !== item)
        blocked("Snapshot contains invalid Unicode");
      continue;
    }
    if (typeof item === "number") {
      if (
        !Number.isFinite(item) ||
        Object.is(item, -0) ||
        (Number.isInteger(item) && !Number.isSafeInteger(item))
      )
        blocked("Snapshot contains an unsafe number");
      continue;
    }
    if (!item || typeof item !== "object" || seen.has(item))
      blocked("Snapshot contains non-JSON data");
    seen.add(item);
    const array = Array.isArray(item);
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype))
      blocked("Snapshot contains unsupported object prototypes");
    const descriptors = Object.getOwnPropertyDescriptors(item);
    if (
      Object.getOwnPropertySymbols(item).length ||
      (array && Object.keys(descriptors).length !== item.length + 1)
    )
      blocked("Snapshot contains unsupported properties");
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (array && key === "length") continue;
      if (
        !Object.hasOwn(descriptor, "value") ||
        !descriptor.enumerable ||
        (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))
      )
        blocked("Snapshot contains unsupported properties");
      pending.push({ value: descriptor.value, depth: next.depth + 1 });
    }
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_BYTES)
    blocked("Snapshot exceeds the 32 MiB limit");
}
function ordered(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, ordered(value[key])]),
    );
  return value;
}
function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(ordered(a as JsonValue)) === JSON.stringify(ordered(b as JsonValue));
}
function decimal(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match || token.length > 128) blocked("Embedded JSON contains unsupported numbers");
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return match[1] ? "-0" : "0";
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent)) blocked("Embedded JSON contains unsupported numbers");
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return `${match[1]}${digits}e${exponent}`;
}
function embedded(raw: unknown): JsonValue {
  if (typeof raw !== "string") blocked("Retained JSON cell is not text");
  for (const token of raw.matchAll(
    /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g,
  )) {
    if (token[0].startsWith('"')) continue;
    const number = Number(token[0]);
    if (
      !Number.isFinite(number) ||
      Object.is(number, -0) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number)) ||
      decimal(token[0]) !== decimal(JSON.stringify(number))
    )
      blocked("Embedded JSON would lose numeric precision");
  }
  const parsed: unknown = JSON.parse(raw);
  boundedJson(parsed);
  return parsed;
}
function base64(value: string): void {
  if (Buffer.from(value, "base64").toString("base64") !== value) blocked("Invalid base64 payload");
}
function blocks(values: JsonObject[]): void {
  const ids = new Set<string>();
  for (const block of values) {
    if (
      typeof block.id !== "string" ||
      !block.id ||
      ids.has(block.id) ||
      typeof block.text !== "string" ||
      ![
        "user",
        "assistant",
        "image",
        "reasoning",
        "tool",
        "approval",
        "tasks",
        "plan",
        "system",
        "handoff",
      ].includes(String(block.role))
    )
      blocked("Transcript contains malformed or duplicate blocks");
    ids.add(block.id);
    if (
      block.streaming === true ||
      block.remoteContent !== undefined ||
      block.pendingQuestion !== undefined
    )
      blocked("Transcript has incomplete live/remote content");
    if (block.attachments !== undefined) attachments(block.attachments);
  }
}
function attachments(value: JsonValue): void {
  if (!Array.isArray(value)) blocked("Attachments must be an array");
  for (const file of value) {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      typeof file.id !== "string" ||
      typeof file.name !== "string" ||
      typeof file.mimeType !== "string" ||
      !["image", "audio", "file"].includes(String(file.kind)) ||
      !Number.isSafeInteger(file.size) ||
      (file.size as number) < 0
    )
      blocked("Malformed retained attachment");
    if (file.data !== undefined) {
      if (typeof file.data !== "string") blocked("Malformed attachment bytes");
      base64(file.data);
    }
    if (file.path !== undefined && typeof file.path !== "string")
      blocked("Malformed attachment path");
  }
}
function privateClientState(source: NativeSource): void {
  if (source.clientOwnedQueue !== null) {
    if (!Array.isArray(source.clientOwnedQueue)) blocked("Client queue is not an array");
    const ids = new Set<string>();
    for (const item of source.clientOwnedQueue) {
      if (
        !item ||
        typeof item !== "object" ||
        Array.isArray(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        ids.has(item.id) ||
        typeof item.text !== "string"
      )
        blocked("Client queue contains malformed or duplicate items");
      ids.add(item.id);
      attachments(item.attachments);
    }
  }
  if (source.clientOwnedDraftJson !== null) {
    const draft = embedded(source.clientOwnedDraftJson);
    if (
      !draft ||
      typeof draft !== "object" ||
      Array.isArray(draft) ||
      typeof draft.text !== "string" ||
      (draft.mcpTags !== undefined && !Array.isArray(draft.mcpTags))
    )
      blocked("Malformed retained composer draft");
    attachments(draft.attachments);
  }
}
function unique(rows: SqlRow[], reason: string): SqlRow | undefined {
  if (rows.length > 1) blocked(reason);
  return rows[0];
}
function matching(actual: unknown, expected: unknown, reason: string): void {
  if (!same(actual, expected)) blocked(reason);
}
function validateRows(source: NativeSource): SqlRow {
  const id = source.session.id;
  const all = source.retainedNativeRows;
  const session = unique(all.sessions, "Conflicting retained session rows");
  if (!session || session.id !== id) blocked("Retained source session is missing or foreign");
  for (const table of tables)
    for (const item of all[table]) {
      for (const value of Object.values(item))
        if (value && typeof value === "object") base64(value.bytes);
      if (table === "sessions") continue;
      const belongs =
        table === "orchestration_runs" || table === "orchestration_sidebar"
          ? item.lead_id === id
          : table === "orchestration_workers"
            ? item.session_id === id || item.lead_id === id
            : item.session_id === id;
      if (!belongs) blocked("Retained row belongs to another conversation");
      if (
        [
          "native_managed_turns",
          "native_rewind_requests",
          "native_rewind_intents",
          "session_rewind_operations",
        ].includes(table) &&
        item.phase !== "complete"
      )
        blocked("Retained native work has not settled");
    }
  for (const field of ["archived", "pinned"])
    if (session[field] !== 0 && session[field] !== 1) blocked("Invalid native visibility metadata");
  const direct = {
    id: "id",
    cwd: "cwd",
    harness: "harness",
    model: "model",
    runtimeMode: "runtime_mode",
    title: "title",
    providerSessionId: "provider_session_id",
    providerAccountId: "provider_account_id",
    contextUsed: "context_used",
    contextWindow: "context_window",
    branch: "branch",
    worktreeCwd: "worktree_cwd",
    workspaceMode: "workspace_mode",
    workspaceId: "workspace_id",
    workspaceRevision: "workspace_revision",
    pendingContextReplay: "pending_context_replay",
    adoptedDivergence: "adopted_divergence",
    adoptedBase: "adopted_base",
    createdAt: "created_at",
    updatedAt: "updated_at",
  } as const;
  for (const column of [
    ...Object.values(direct),
    "model_settings",
    "blocks_json",
    "worktree_removed",
    "automation_id",
    "linked_work_item_json",
    "rewind_history_json",
    "inbox_ask",
    "has_user_message",
    "is_draft",
  ])
    if (!Object.hasOwn(session, column)) blocked("Native session row is missing a source column");
  if (session.inbox_ask !== null) blocked("Temporary Inbox conversations cannot be promoted");
  if (session.is_draft !== 0 || session.has_user_message !== 1)
    blocked("Ephemeral or unsent draft sessions remain native-owned");
  for (const [property, column] of Object.entries(direct))
    matching(
      session[column] ?? undefined,
      source.session[property as keyof NativeRecord],
      "Native record and retained session disagree",
    );
  matching(
    embedded(session.model_settings),
    source.session.modelSettings,
    "Native model settings disagree",
  );
  for (const [property, column] of [
    ["managedBy", "assistant_management_json"],
    ["linkedWorkItem", "linked_work_item_json"],
    ["rewindHistory", "rewind_history_json"],
  ] as const) {
    matching(
      session[column] == null ? undefined : embedded(session[column]),
      source.session[property],
      "Retained feature metadata disagrees",
    );
  }
  if (typeof session.worktree_removed !== "number")
    blocked("Missing native workspace removal state");
  matching(
    session.worktree_removed !== 0,
    source.session.worktreeRemoved,
    "Native workspace removal state disagrees",
  );
  matching(
    typeof session.automation_id === "string" && session.automation_id !== ""
      ? session.automation_id
      : undefined,
    source.session.automationId,
    "Native automation identity disagrees",
  );
  const ownWorker = unique(
    all.orchestration_workers.filter((item) => item.session_id === id),
    "Conflicting orchestration worker ownership",
  );
  matching(
    ownWorker?.lead_id,
    source.session.orchestrationLeadId,
    "Native orchestration ownership disagrees",
  );
  const state = unique(all.session_block_state, "Conflicting native transcript revisions");
  matching(
    state?.revision,
    source.session.transcriptRevision,
    "Native transcript revision disagrees",
  );
  if (state && typeof state.length !== "number") blocked("Malformed native transcript state");
  if (state && (state.length as number) >= 0) {
    matching(state.length, source.session.blocks.length, "Native transcript length disagrees");
    const indexed = [...all.session_blocks].sort((a, b) => Number(a.ordinal) - Number(b.ordinal));
    if (indexed.length !== source.session.blocks.length)
      blocked("Native transcript rows are incomplete");
    indexed.forEach((item, index) => {
      if (
        item.ordinal !== index ||
        item.block_id !== source.session.blocks[index].id ||
        !Number.isSafeInteger(item.revision) ||
        (item.revision as number) < 0 ||
        (item.revision as number) > (state.revision as number)
      )
        blocked("Malformed native block index");
      matching(
        embedded(item.block_json),
        source.session.blocks[index],
        "Native transcript payload disagrees",
      );
    });
  } else {
    if (state && state.length !== -1) blocked("Unsupported native transcript state");
    matching(
      embedded(session.blocks_json),
      source.session.blocks,
      "Legacy native transcript disagrees",
    );
  }
  for (const [table, field, actual] of [
    ["session_queues", "queue_json", source.clientOwnedQueue],
    ["composer_drafts", "draft_json", source.clientOwnedDraftJson],
  ] as const) {
    const saved = unique(all[table], "Conflicting client-owned rows");
    const expected = !saved
      ? null
      : table === "composer_drafts"
        ? saved[field]
        : embedded(saved[field]);
    matching(expected, actual, "Client-owned state and retained row disagree");
  }
  return session;
}

function build(
  source: NativeSource,
  identity: z.infer<typeof preservation>,
  options: NativeSnapshotConverterOptions,
  generation: number,
): NativeMigrationTarget {
  const record = source.session;
  if (record.cwd !== options.expectedCwd)
    blocked("Source working directory differs from captured Host project");
  if (
    record.id !== identity.sessionId ||
    (record.transcriptRevision ?? 0) !== identity.sourceRevision
  )
    blocked("Source session/revision differs from native fence");
  if (record.workspaceRevision !== undefined && record.workspaceId === undefined)
    blocked("Workspace revision lacks its identity");
  if (record.contextWindow !== undefined && record.contextUsed === undefined)
    blocked("Native context window lacks a used-token observation");
  if (record.blocks.some((block) => block.role === "user" && block.draft === true))
    blocked("Unsent draft sessions remain native-owned");
  blocks(record.blocks);
  for (const entry of record.rewindHistory ?? []) blocks(entry.blocks);
  privateClientState(source);
  const saved = validateRows(source);
  const { blocks: _blocks, ...projection } = record;
  const {
    transcriptRevision: _revision,
    contextUsed,
    contextWindow,
    adoptedBase,
    adoptedDivergence,
    createdAt,
    updatedAt,
    ...session
  } = record;
  const converted: Session = {
    ...session,
    ...(contextUsed === undefined
      ? {}
      : {
          context: {
            used: contextUsed,
            ...(contextWindow === undefined ? {} : { window: contextWindow }),
          },
        }),
    ...(adoptedBase === undefined ? {} : { adoptedBase: head.parse(embedded(adoptedBase)) }),
    ...(adoptedDivergence === undefined
      ? {}
      : { adoptedDivergence: divergence.parse(embedded(adoptedDivergence)) }),
  } as unknown as Session;
  const target = ordered({
    version: 1,
    kind: "native-session-target",
    hostSession: {
      session: converted,
      projectId: options.projectId,
      revision: identity.sourceRevision,
      authorityGeneration: generation,
      status: "idle",
      createdAt,
      updatedAt,
      archived: saved.archived === 1,
      pinned: saved.pinned === 1,
    },
    nativePreservation: { ...identity, recordProjection: projection },
  } as unknown as JsonValue);
  boundedJson(target);
  return target as unknown as NativeMigrationTarget;
}

/** No I/O, provider execution or qualification. Caller authenticates source bytes/fence. */
export function createNativeSnapshotConverter(
  options: NativeSnapshotConverterOptions,
): AuthoritySnapshotConverter {
  const captured = z
    .strictObject({ projectId: IdentifierSchema, expectedCwd: text.min(1) })
    .parse(options);
  return Object.freeze({
    version: NATIVE_SNAPSHOT_CONVERTER_VERSION,
    convert(
      value: Parameters<AuthoritySnapshotConverter["convert"]>[0],
      rawFence: Readonly<NativeFenceEvidence>,
    ) {
      try {
        boundedJson(value);
        const source = NativeSourceSchema.parse(value);
        matching(source, value, "Native schema would discard source values");
        const fence: NativeFenceEvidence = NativeFenceEvidenceSchema.parse(rawFence);
        if (fence.minWriterProtocol !== 2) blocked("Unsupported native writer protocol");
        if (
          !fence.quiescent ||
          fence.unknownReservations ||
          !fence.writerInventoryVerified ||
          fence.unsupportedWriters
        )
          blocked("Native source is not a complete idle observation");
        return build(
          source,
          {
            version: 1,
            environmentId: fence.environmentId,
            sourceProfileId: fence.sourceProfileId,
            sourceStoreId: fence.sourceStoreId,
            sessionId: fence.sessionId,
            migrationId: fence.migrationId,
            sourceDigest: fence.sourceDigest,
            sourceRevision: fence.sourceRevision,
            clientOwnedQueue: source.clientOwnedQueue,
            clientOwnedDraftJson: source.clientOwnedDraftJson,
            retainedNativeRows: source.retainedNativeRows,
            recordProjection: (({ blocks: _blocks, ...record }) => record)(source.session),
          },
          captured,
          fence.generation,
        );
      } catch (error) {
        if (error instanceof NativeSnapshotConversionError) throw error;
        throw new NativeSnapshotConversionError("Malformed or unsupported native snapshot");
      }
    },
  });
}

/** Internal consistency only; the journal separately binds exact source bytes/fence and its decision. */
export function validateNativeMigrationTarget(value: unknown): NativeMigrationTarget {
  try {
    boundedJson(value);
    const parsed = NativeMigrationTargetSchema.parse(value);
    const source = NativeSourceSchema.parse({
      session: {
        ...parsed.nativePreservation.recordProjection,
        blocks: parsed.hostSession.session.blocks,
      },
      clientOwnedQueue: parsed.nativePreservation.clientOwnedQueue,
      clientOwnedDraftJson: parsed.nativePreservation.clientOwnedDraftJson,
      retainedNativeRows: parsed.nativePreservation.retainedNativeRows,
    });
    const rebuilt = build(
      source,
      parsed.nativePreservation,
      { projectId: parsed.hostSession.projectId, expectedCwd: parsed.hostSession.session.cwd },
      parsed.hostSession.authorityGeneration,
    );
    matching(rebuilt, parsed, "Normalized target differs from its exact native projection");
    return rebuilt;
  } catch (error) {
    if (error instanceof NativeSnapshotConversionError) throw error;
    throw new NativeSnapshotConversionError("Malformed native migration target");
  }
}

/** Returns only the public conversation projection; private recovery state stays in the journal. */
export function projectNativeMigrationHostSession(value: unknown): HostSession {
  return validateNativeMigrationTarget(value).hostSession;
}
