import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  NativeFenceEvidenceSchema,
  HostAuthorityDecisionSchema,
  hostAuthorityDecisionDigestInput,
  type NativeFenceEvidence,
  type HostAuthorityDecision,
} from "../../src/shared/model/host-contracts/authority";
import {
  IdentifierSchema,
  JsonValueSchema,
  SafeCounterSchema,
} from "../../src/shared/model/host-contracts/schemas";
import type { HostSession } from "../../src/features/connections/model/protocol";
import type { HostStore } from "../store";
import {
  createNativeSnapshotConverter,
  validateNativeMigrationTarget,
  projectNativeMigrationHostSession,
  type NativeMigrationTarget,
} from "./native-snapshot-converter";

const ScopeSchema = z.strictObject({
  environmentId: IdentifierSchema,
  sessionId: IdentifierSchema,
  migrationId: IdentifierSchema,
});
export type AuthorityScope = z.infer<typeof ScopeSchema>;
const ContextSchema = ScopeSchema.extend({
  sourceProfileId: IdentifierSchema,
  sourceStoreId: IdentifierSchema,
  nativeActorId: IdentifierSchema,
  challenge: IdentifierSchema,
});
export type AuthorityRequestContext = z.infer<typeof ContextSchema>;
export type AuthorityStage = {
  fence: NativeFenceEvidence;
  sourceJson: string;
  normalizedSnapshot: HostSession | NativeMigrationTarget;
  converterVersion: string;
  targetDigest: string;
};
/** The target envelope is journal-private; normal session rows contain only its projection. */
export function isNativeAuthorityTarget(value: unknown): value is NativeMigrationTarget {
  return !!value && typeof value === "object" && Object.hasOwn(value, "kind");
}
export function authorityTargetHostSession(
  value: AuthorityStage["normalizedSnapshot"],
): HostSession {
  return isNativeAuthorityTarget(value) ? projectNativeMigrationHostSession(value) : value;
}
export type AuthorityStatus = {
  phase: "prepared" | "staged" | "host-active" | "aborted";
  fence: NativeFenceEvidence;
  decision?: HostAuthorityDecision;
  acknowledged: boolean;
  targetDigest?: string;
  converterVersion?: string;
};
type JournalRow = {
  generation: number;
  phase: AuthorityStatus["phase"];
  evidence: string;
  decision: string | null;
  acknowledged: number;
  target_digest: string | null;
  converter_version: string | null;
  source_json: string | null;
  target_json: string | null;
};
const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const HOST_AUTHORITY_WRITER_PROTOCOL = 2;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => contains(actual[index], value))
    );
  if (expected && typeof expected === "object")
    return (
      !!actual &&
      typeof actual === "object" &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(
        ([key, value]) =>
          Object.hasOwn(actual, key) && contains((actual as Record<string, unknown>)[key], value),
      )
    );
  return actual === expected;
}

function checkedTarget(
  value: unknown,
  sourceJson: string,
  fence: NativeFenceEvidence,
  converterVersion: string,
): AuthorityStage["normalizedSnapshot"] {
  const json = JsonValueSchema.parse(value);
  const source = JsonValueSchema.parse(JSON.parse(sourceJson));
  const hasPrivateNativeState =
    !!source &&
    typeof source === "object" &&
    !Array.isArray(source) &&
    ["clientOwnedQueue", "clientOwnedDraftJson", "retainedNativeRows"].some((key) =>
      Object.hasOwn(source, key),
    );
  if (!isNativeAuthorityTarget(json)) {
    if (hasPrivateNativeState)
      throw new Error("Native source requires a private preservation target.");
    return json as unknown as HostSession;
  }
  const target = validateNativeMigrationTarget(json);
  const converter = createNativeSnapshotConverter({
    projectId: target.hostSession.projectId,
    expectedCwd: target.hostSession.session.cwd,
  });
  if (
    converterVersion !== converter.version ||
    canonical(converter.convert(source, fence)) !== canonical(target)
  )
    throw new Error("Native migration target changed its source preservation.");
  return target;
}

/** Host-side journal only: trusted native IPC/challenge verification is mandatory. */
export class HostAuthorityJournal {
  readonly ready: Promise<void>;
  constructor(
    private readonly options: {
      store: HostStore;
      verifyNativeActorAndChallenge: (
        fence: NativeFenceEvidence,
        context: AuthorityRequestContext,
      ) => Promise<void>;
      /** Required to mark CACHE_ACKED: authenticated native proof of this exact durable decision. */
      verifyNativeDecisionAcknowledgement?: (
        fence: NativeFenceEvidence,
        decision: HostAuthorityDecision,
        context: AuthorityRequestContext,
      ) => Promise<void>;
      /** SQL/domain storage only. No provider, network, process or filesystem effects. */
      installTarget: (stage: AuthorityStage, decision: HostAuthorityDecision) => Promise<void>;
      now?: () => number;
    },
  ) {
    if (
      typeof options.verifyNativeActorAndChallenge !== "function" ||
      typeof options.installTarget !== "function"
    )
      throw new Error("Authority journal requires trusted verifier and SQL target installer.");
    this.ready = options.store.ready.then(() =>
      options.store.transaction(async () => {
        await options.store.db.exec(`CREATE TABLE IF NOT EXISTS host_authority_journal (
        migration_id TEXT PRIMARY KEY, environment_id TEXT NOT NULL, session_id TEXT NOT NULL,
        generation INTEGER NOT NULL, phase TEXT NOT NULL, evidence TEXT NOT NULL,
        source_json TEXT, target_json TEXT, target_digest TEXT, converter_version TEXT,
        decision TEXT, acknowledged INTEGER NOT NULL DEFAULT 0,
        UNIQUE(environment_id, session_id, generation));
        CREATE TABLE IF NOT EXISTS host_authority_heads (
        environment_id TEXT NOT NULL, session_id TEXT NOT NULL, generation INTEGER NOT NULL,
        migration_id TEXT NOT NULL, phase TEXT NOT NULL, PRIMARY KEY(environment_id, session_id));`);
      }),
    );
    void this.ready.catch(() => undefined);
  }

  private async verified(
    raw: NativeFenceEvidence,
    rawContext: AuthorityRequestContext,
  ): Promise<NativeFenceEvidence> {
    if (this.options.store.db.ownsScope)
      throw new Error("Native authority verification must precede SQL admission.");
    const fence = NativeFenceEvidenceSchema.parse(raw),
      context = ContextSchema.parse(rawContext);
    if (fence.minWriterProtocol > HOST_AUTHORITY_WRITER_PROTOCOL)
      throw new Error("Authority migration requires a supported Host writer protocol.");
    if (
      fence.environmentId !== this.options.store.environmentId ||
      ["environmentId", "sessionId", "migrationId", "sourceProfileId", "sourceStoreId"].some(
        (field) =>
          fence[field as keyof NativeFenceEvidence] !==
          context[field as keyof AuthorityRequestContext],
      )
    )
      throw new Error("Native authority scope does not match this Host request.");
    // Never accept serialized safety booleans as proof. This injected native verifier
    // must check authenticated actor, one-use challenge and durable source fence.
    await this.options.verifyNativeActorAndChallenge(fence, context);
    return fence;
  }
  private async row(scope: AuthorityScope): Promise<JournalRow | undefined> {
    return (await this.options.store.db
      .prepare(
        "SELECT * FROM host_authority_journal WHERE migration_id=? AND environment_id=? AND session_id=?",
      )
      .get(scope.migrationId, scope.environmentId, scope.sessionId)) as JournalRow | undefined;
  }
  private statusOf(row: JournalRow): AuthorityStatus {
    const fence = NativeFenceEvidenceSchema.parse(JSON.parse(row.evidence));
    return {
      phase: row.phase,
      fence: NativeFenceEvidenceSchema.parse(JSON.parse(row.evidence)),
      acknowledged: !!row.acknowledged,
      ...(row.decision ? { decision: this.readDecision(row, fence) } : {}),
      ...(row.target_digest ? { targetDigest: row.target_digest } : {}),
      ...(row.converter_version ? { converterVersion: row.converter_version } : {}),
    };
  }
  private readDecision(row: JournalRow, fence: NativeFenceEvidence): HostAuthorityDecision {
    const decision = HostAuthorityDecisionSchema.parse(JSON.parse(row.decision!));
    if (
      sha256(hostAuthorityDecisionDigestInput(decision)) !== decision.decisionDigest ||
      [
        "environmentId",
        "sessionId",
        "migrationId",
        "sourceProfileId",
        "sourceStoreId",
        "sourceRevision",
        "sourceDigest",
        "evidenceDigest",
        "minWriterProtocol",
      ].some(
        (key) =>
          decision[key as keyof HostAuthorityDecision] !== fence[key as keyof NativeFenceEvidence],
      ) ||
      decision.sourceGeneration !== fence.generation ||
      decision.phase !== row.phase ||
      (decision.targetDigest ?? null) !== row.target_digest ||
      (decision.phase === "host-active"
        ? decision.authorityGeneration !== fence.generation ||
          decision.targetDigest !== row.target_digest
        : decision.authorityGeneration <= fence.generation)
    )
      throw new Error("Stored authority decision integrity verification failed.");
    if (
      row.target_digest &&
      (!row.source_json ||
        !row.target_json ||
        !row.converter_version ||
        Buffer.byteLength(row.source_json, "utf8") > MAX_SOURCE_BYTES ||
        Buffer.byteLength(row.target_json, "utf8") > MAX_SOURCE_BYTES ||
        sha256(row.source_json) !== fence.sourceDigest ||
        sha256(row.target_json) !== row.target_digest)
    )
      throw new Error("Stored authority snapshot integrity verification failed.");
    return decision;
  }
  private async exists(sessionId: string): Promise<boolean> {
    return !!(await this.options.store.db
      .prepare("SELECT id FROM sessions WHERE id=?")
      .get(sessionId));
  }
  private async matching(fence: NativeFenceEvidence): Promise<JournalRow> {
    const row = await this.row(fence);
    if (
      !row ||
      Number(row.generation) !== fence.generation ||
      row.evidence !== JSON.stringify(fence)
    )
      throw new Error("Authority migration evidence is missing or conflicts with its frozen body.");
    return row;
  }
  async status(raw: AuthorityScope): Promise<AuthorityStatus | undefined> {
    const scope = ScopeSchema.parse(raw);
    await this.ready;
    if (scope.environmentId !== this.options.store.environmentId)
      throw new Error("Authority environment does not match this Host.");
    return this.options.store.db.scope(async () => {
      const row = await this.row(scope);
      return row ? this.statusOf(row) : undefined;
    });
  }
  /** Trusted recovery read. Requires fresh native verification; never a session DTO/RPC. */
  async readNativePreservation(
    raw: NativeFenceEvidence,
    context: AuthorityRequestContext,
  ): Promise<NativeMigrationTarget["nativePreservation"] | undefined> {
    const fence = await this.verified(raw, context);
    await this.ready;
    return this.options.store.transaction(async () => {
      const row = await this.matching(fence);
      if (row.phase !== "host-active" || !row.decision)
        throw new Error("Native preservation requires a committed Host target.");
      this.readDecision(row, fence);
      const target = checkedTarget(
        JSON.parse(row.target_json!),
        row.source_json!,
        fence,
        row.converter_version!,
      );
      return isNativeAuthorityTarget(target) ? target.nativePreservation : undefined;
    });
  }
  async prepare(
    raw: NativeFenceEvidence,
    context: AuthorityRequestContext,
  ): Promise<AuthorityStatus> {
    const fence = await this.verified(raw, context);
    await this.ready;
    return this.options.store.transaction(async () => {
      const existing = await this.options.store.db
        .prepare("SELECT * FROM host_authority_journal WHERE migration_id=?")
        .get(fence.migrationId);
      if (existing) return this.statusOf(await this.matching(fence));
      const head = await this.options.store.db
        .prepare("SELECT * FROM host_authority_heads WHERE environment_id=? AND session_id=?")
        .get(fence.environmentId, fence.sessionId);
      if (head && (head.phase !== "native-aborted" || fence.generation <= Number(head.generation)))
        throw new Error("Authority generation is stale or another migration owns the session.");
      if (head) {
        const prior = await this.options.store.db
          .prepare("SELECT evidence FROM host_authority_journal WHERE migration_id=?")
          .get(String(head.migration_id));
        const previous =
          prior && NativeFenceEvidenceSchema.parse(JSON.parse(String(prior.evidence)));
        if (
          !previous ||
          previous.sourceProfileId !== fence.sourceProfileId ||
          previous.sourceStoreId !== fence.sourceStoreId
        )
          throw new Error("Authority source store/profile changed across generations.");
      }
      if (await this.exists(fence.sessionId))
        throw new Error(
          "Existing Host conversation must be reconciled; migration cannot overwrite it.",
        );
      await this.options.store.db
        .prepare(
          "INSERT INTO host_authority_journal (migration_id, environment_id, session_id, generation, phase, evidence) VALUES (?, ?, ?, ?, 'prepared', ?)",
        )
        .run(
          fence.migrationId,
          fence.environmentId,
          fence.sessionId,
          fence.generation,
          JSON.stringify(fence),
        );
      await this.options.store.db
        .prepare(
          "INSERT INTO host_authority_heads VALUES (?, ?, ?, ?, 'native-fenced') ON CONFLICT(environment_id,session_id) DO UPDATE SET generation=excluded.generation,migration_id=excluded.migration_id,phase=excluded.phase",
        )
        .run(fence.environmentId, fence.sessionId, fence.generation, fence.migrationId);
      return this.statusOf(await this.matching(fence));
    });
  }
  async stage(
    input: Omit<AuthorityStage, "targetDigest">,
    context: AuthorityRequestContext,
  ): Promise<AuthorityStatus> {
    const fence = await this.verified(input.fence, context);
    await this.ready;
    if (
      typeof input.sourceJson !== "string" ||
      Buffer.byteLength(input.sourceJson, "utf8") > MAX_SOURCE_BYTES ||
      Buffer.from(input.sourceJson, "utf8").toString("utf8") !== input.sourceJson ||
      sha256(input.sourceJson) !== fence.sourceDigest
    )
      throw new Error("Source snapshot bytes or digest do not match the native fence.");
    IdentifierSchema.parse(input.converterVersion);
    const source = JsonValueSchema.parse(JSON.parse(input.sourceJson)) as Record<string, unknown>;
    const target = checkedTarget(
      input.normalizedSnapshot,
      input.sourceJson,
      fence,
      input.converterVersion,
    );
    const normalized = authorityTargetHostSession(target);
    const native = (source?.id === fence.sessionId ? source : source?.session) as
      | Record<string, unknown>
      | undefined;
    if (
      !native ||
      native.id !== fence.sessionId ||
      normalized?.session?.id !== fence.sessionId ||
      (normalized.status !== "idle" && normalized.status !== "interrupted") ||
      native.busy ||
      native.pendingQuestion ||
      native.historyPartial ||
      normalized.session.busy ||
      normalized.session.pendingQuestion ||
      !Array.isArray(normalized.session.blocks) ||
      normalized.history ||
      normalized.session.historyPartial
    )
      throw new Error("Migration requires a complete idle source and matching normalized session.");
    IdentifierSchema.parse(normalized.projectId);
    if (
      normalized.authorityGeneration !== undefined &&
      normalized.authorityGeneration !== fence.generation
    )
      throw new Error("Normalized snapshot authority generation differs from the native fence.");
    SafeCounterSchema.parse(normalized.revision);
    SafeCounterSchema.parse(normalized.updatedAt);
    for (const key of [
      "id",
      "cwd",
      "worktreeCwd",
      "workspaceId",
      "workspaceMode",
      "harness",
      "providerSessionId",
      "providerAccountId",
      "model",
      "modelSettings",
      "runtimeMode",
      "blocks",
      "pendingContextReplay",
      "pendingSwitch",
    ])
      if (
        canonical(native[key]) !==
        canonical((normalized.session as unknown as Record<string, unknown>)[key])
      )
        throw new Error("Normalized snapshot changed protected source conversation fields.");
    const targetJson = JSON.stringify(target),
      targetDigest = sha256(targetJson);
    if (Buffer.byteLength(targetJson, "utf8") > MAX_SOURCE_BYTES)
      throw new Error("Normalized snapshot exceeds the migration size limit.");
    return this.options.store.transaction(async () => {
      const row = await this.matching(fence);
      if (row.target_json) {
        if (
          row.source_json !== input.sourceJson ||
          row.target_json !== targetJson ||
          row.converter_version !== input.converterVersion
        )
          throw new Error("Migration stage differs from its immutable snapshot.");
        return this.statusOf(row);
      }
      if (row.phase !== "prepared") throw new Error("Terminal migration cannot be staged.");
      await this.options.store.db
        .prepare(
          "UPDATE host_authority_journal SET phase='staged',source_json=?,target_json=?,target_digest=?,converter_version=? WHERE migration_id=? AND phase='prepared'",
        )
        .run(input.sourceJson, targetJson, targetDigest, input.converterVersion, fence.migrationId);
      return this.statusOf(await this.matching(fence));
    });
  }
  private decision(
    fence: NativeFenceEvidence,
    phase: "host-active" | "aborted",
    targetDigest?: string,
  ): HostAuthorityDecision {
    const generation = phase === "host-active" ? fence.generation : fence.generation + 1;
    SafeCounterSchema.min(1).parse(generation);
    const value = {
      protocol: 2 as const,
      environmentId: fence.environmentId,
      sessionId: fence.sessionId,
      migrationId: fence.migrationId,
      sourceProfileId: fence.sourceProfileId,
      sourceStoreId: fence.sourceStoreId,
      receiptId: randomUUID(),
      sourceGeneration: fence.generation,
      authorityGeneration: generation,
      sourceRevision: fence.sourceRevision,
      sourceDigest: fence.sourceDigest,
      evidenceDigest: fence.evidenceDigest,
      minWriterProtocol: fence.minWriterProtocol,
      committedAt: SafeCounterSchema.parse((this.options.now ?? Date.now)()),
      phase,
      ...(targetDigest ? { targetDigest } : {}),
    };
    return HostAuthorityDecisionSchema.parse({
      ...value,
      decisionDigest: sha256(hostAuthorityDecisionDigestInput(value)),
    });
  }
  private async terminal(
    fence: NativeFenceEvidence,
    phase: "host-active" | "aborted",
  ): Promise<HostAuthorityDecision> {
    return this.options.store.transaction(async () => {
      const row = await this.matching(fence);
      if (row.decision) {
        const decision = this.readDecision(row, fence);
        if (decision.phase !== phase)
          throw new Error("Authority migration already has the opposite terminal decision.");
        return decision;
      }
      if (row.phase !== "prepared" && row.phase !== "staged")
        throw new Error("Authority journal phase is not admissible.");
      if (phase === "host-active" && row.phase !== "staged")
        throw new Error("Authority activation requires an immutable staged snapshot.");
      const decision = this.decision(fence, phase, row.target_digest ?? undefined);
      const head = await this.options.store.db
        .prepare("SELECT * FROM host_authority_heads WHERE environment_id=? AND session_id=?")
        .get(fence.environmentId, fence.sessionId);
      if (
        !head ||
        head.migration_id !== fence.migrationId ||
        Number(head.generation) !== fence.generation ||
        head.phase !== "native-fenced"
      )
        throw new Error("Authority head changed before terminal admission.");
      let installation: AuthorityStage | undefined;
      if (phase === "host-active") {
        if (await this.exists(fence.sessionId))
          throw new Error("Activation cannot overwrite an existing Host conversation.");
        if (
          !row.source_json ||
          !row.target_json ||
          !row.converter_version ||
          sha256(row.source_json) !== fence.sourceDigest ||
          sha256(row.target_json) !== row.target_digest
        )
          throw new Error("Immutable staged snapshot integrity verification failed.");
        installation = {
          fence: Object.freeze(NativeFenceEvidenceSchema.parse(fence)),
          sourceJson: row.source_json!,
          normalizedSnapshot: checkedTarget(
            JSON.parse(row.target_json!),
            row.source_json!,
            fence,
            row.converter_version!,
          ),
          converterVersion: row.converter_version!,
          targetDigest: row.target_digest!,
        };
      }
      const changed = await this.options.store.db
        .prepare(
          "UPDATE host_authority_journal SET phase=?,decision=? WHERE migration_id=? AND decision IS NULL",
        )
        .run(phase, JSON.stringify(decision), fence.migrationId);
      if (Number(changed.changes) !== 1)
        throw new Error("Authority terminal decision lost its compare-and-swap.");
      const moved = await this.options.store.db
        .prepare(
          "UPDATE host_authority_heads SET phase=?,generation=? WHERE environment_id=? AND session_id=? AND migration_id=? AND generation=?",
        )
        .run(
          phase === "host-active" ? "host-active" : "native-aborted",
          decision.authorityGeneration,
          fence.environmentId,
          fence.sessionId,
          fence.migrationId,
          fence.generation,
        );
      if (Number(moved.changes) !== 1)
        throw new Error("Authority head changed during target installation.");
      if (installation) {
        await this.options.store.withAuthorityGeneration(
          fence.sessionId,
          decision.authorityGeneration,
          () => this.options.installTarget(installation!, Object.freeze(decision)),
        );
        const retained = await this.matching(fence);
        this.readDecision(retained, fence);
        if (
          retained.phase !== "host-active" ||
          retained.acknowledged !== row.acknowledged ||
          retained.generation !== row.generation ||
          retained.evidence !== row.evidence ||
          retained.decision !== JSON.stringify(decision) ||
          retained.target_json !== row.target_json ||
          retained.source_json !== row.source_json ||
          retained.converter_version !== row.converter_version
        )
          throw new Error("Target installer changed immutable migration storage.");
        const installedHead = await this.options.store.db
          .prepare(
            "SELECT migration_id,generation,phase FROM host_authority_heads WHERE environment_id=? AND session_id=?",
          )
          .get(fence.environmentId, fence.sessionId);
        if (
          !installedHead ||
          installedHead.migration_id !== fence.migrationId ||
          Number(installedHead.generation) !== decision.authorityGeneration ||
          installedHead.phase !== "host-active"
        )
          throw new Error("Target installer changed the authority head.");
        const installed = await this.options.store.session(fence.sessionId);
        if (
          installed.authorityGeneration !== decision.authorityGeneration ||
          !contains(installed, authorityTargetHostSession(JSON.parse(row.target_json!)))
        )
          throw new Error("Target installer did not persist the staged conversation.");
      }
      this.options.store.authorityDecisionCommitted({
        sessionId: fence.sessionId,
        authorityGeneration: decision.authorityGeneration,
        phase,
        ...(row.target_json
          ? {
              projectId: authorityTargetHostSession(
                JSON.parse(row.target_json) as AuthorityStage["normalizedSnapshot"],
              ).projectId,
            }
          : {}),
      });
      return decision;
    });
  }
  async activate(
    raw: NativeFenceEvidence,
    context: AuthorityRequestContext,
  ): Promise<HostAuthorityDecision> {
    const fence = await this.verified(raw, context);
    await this.ready;
    return this.terminal(fence, "host-active");
  }
  async abort(
    raw: NativeFenceEvidence,
    context: AuthorityRequestContext,
  ): Promise<HostAuthorityDecision> {
    const fence = await this.verified(raw, context);
    await this.ready;
    return this.terminal(fence, "aborted");
  }
  async ack(
    raw: NativeFenceEvidence,
    decisionDigest: string,
    context: AuthorityRequestContext,
  ): Promise<AuthorityStatus> {
    const fence = await this.verified(raw, context);
    await this.ready;
    const prior = await this.options.store.db.scope(async () =>
      this.statusOf(await this.matching(fence)),
    );
    if (!prior?.decision || prior.decision.decisionDigest !== decisionDigest)
      throw new Error("Native acknowledgement does not match a committed authority decision.");
    if (!this.options.verifyNativeDecisionAcknowledgement)
      throw new Error("Trusted native decision acknowledgement verification is unavailable.");
    await this.options.verifyNativeDecisionAcknowledgement(
      fence,
      prior.decision,
      ContextSchema.parse(context),
    );
    return this.options.store.transaction(async () => {
      const row = await this.matching(fence);
      if (!row.decision || this.readDecision(row, fence).decisionDigest !== decisionDigest)
        throw new Error("Native acknowledgement does not match a committed authority decision.");
      await this.options.store.db
        .prepare("UPDATE host_authority_journal SET acknowledged=1 WHERE migration_id=?")
        .run(fence.migrationId);
      return this.statusOf(await this.matching(fence));
    });
  }
  /** Root command/provider admission must call this before external work. */
  async assertHostWriteAllowed(sessionId: string, expectedGeneration?: number): Promise<void> {
    IdentifierSchema.parse(sessionId);
    if (expectedGeneration !== undefined) SafeCounterSchema.min(1).parse(expectedGeneration);
    await this.ready;
    const head = await this.options.store.db
      .prepare("SELECT * FROM host_authority_heads WHERE environment_id=? AND session_id=?")
      .get(this.options.store.environmentId, sessionId);
    if (!head) {
      if (expectedGeneration !== undefined)
        throw new Error("Host authority generation is unknown.");
      return;
    }
    if (
      head.phase !== "host-active" ||
      expectedGeneration === undefined ||
      Number(head.generation) !== expectedGeneration
    )
      throw new Error("Host write authority requires the committed current generation.");
  }
}
