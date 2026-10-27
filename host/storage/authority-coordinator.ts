import { createHash } from "node:crypto";
import {
  HostAuthorityDecisionSchema,
  NativeFenceEvidenceSchema,
  NativeQuiesceCancellationSchema,
  type NativeQuiesceCancellation,
  hostAuthorityDecisionDigestInput,
  type HostAuthorityDecision,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import {
  IdentifierSchema,
  SafeCounterSchema,
  type JsonValue,
} from "../../src/shared/model/host-contracts/schemas";
import type {
  AuthorityRequestContext,
  AuthorityScope,
  AuthorityStage,
  AuthorityStatus,
  HostAuthorityJournal,
} from "./authority-journal";

type Snapshot = AuthorityStage["normalizedSnapshot"];
type Journal = Pick<
  HostAuthorityJournal,
  "status" | "prepare" | "stage" | "activate" | "abort" | "ack"
>;
export type AuthorityCoordinatorStep =
  | "cancel-quiesce"
  | "read-snapshot"
  | "fence"
  | "prepare"
  | "stage"
  | "activate"
  | "abort"
  | "verify-decision"
  | "apply-decision"
  | "read-native-ack"
  | "host-ack";
export type NativeAuthoritySnapshot = { fence: NativeFenceEvidence; sourceJson: string };

/**
 * Trusted composition only. The qualified native adapter owns writer inventory,
 * editor/window barriers, durable fences and opaque decision handles. Serialized
 * booleans, a renderer-provided snapshot, or a self-hashed DTO cannot implement
 * those checks. Journal actor and decision-ack verifiers remain mandatory and
 * independent of the coordinator's DTO/digest consistency checks.
 */
export interface AuthenticatedNativeAuthorityPort {
  /** Native CAS decides the outcome; missing snapshot is never cancellation proof. */
  cancelQuiesce(
    expectedSourceGeneration: number,
    context: AuthorityRequestContext,
  ): Promise<
    | { kind: "cancelled"; receipt: NativeQuiesceCancellation }
    | { kind: "fenced"; snapshot: NativeAuthoritySnapshot }
  >;
  authenticatedContext(
    scope: Readonly<AuthorityScope>,
    step: AuthorityCoordinatorStep,
  ): Promise<AuthorityRequestContext>;
  readFenceSnapshot(context: AuthorityRequestContext): Promise<NativeAuthoritySnapshot | undefined>;
  quiesceAndFence(
    expectedSourceGeneration: number,
    context: AuthorityRequestContext,
  ): Promise<NativeAuthoritySnapshot>;
  verifyHostDecision(
    decision: Readonly<HostAuthorityDecision>,
    context: AuthorityRequestContext,
  ): Promise<object>;
  applyVerifiedDecision(nativeOwnedHandle: object, context: AuthorityRequestContext): Promise<void>;
  readDecisionAcknowledgement(
    decision: Readonly<HostAuthorityDecision>,
    context: AuthorityRequestContext,
  ): Promise<HostAuthorityDecision>;
}
type ImmutableJson =
  | null
  | boolean
  | number
  | string
  | readonly ImmutableJson[]
  | { readonly [key: string]: ImmutableJson };
export interface AuthoritySnapshotConverter {
  readonly version: string;
  /** Synchronous, deterministic conversion; no I/O or source mutation. */
  convert(source: ImmutableJson, fence: Readonly<NativeFenceEvidence>): Snapshot;
}
export type AuthorityCoordinationResult = {
  decision: HostAuthorityDecision;
  status: AuthorityStatus;
};

export class AuthorityCoordinatorBlockedError extends Error {
  readonly code = "AUTHORITY_COORDINATOR_BLOCKED";
}
export class AuthorityCoordinatorBusyError extends Error {
  readonly code = "AUTHORITY_COORDINATOR_BUSY";
}

/** Actual backend work holds admission until settlement, including abandoned waits. */
export class AuthorityCoordinatorAdmission {
  private readonly sessions = new Set<string>();
  constructor(private readonly maximum = 4) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 64)
      throw new Error("Invalid authority migration admission limit");
  }
  get size(): number {
    return this.sessions.size;
  }
  async run<T>(scope: AuthorityScope, operation: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([scope.environmentId, scope.sessionId]);
    if (this.sessions.has(key) || this.sessions.size >= this.maximum)
      throw new AuthorityCoordinatorBusyError("Authority migration admission is busy");
    this.sessions.add(key);
    try {
      return await operation();
    } finally {
      this.sessions.delete(key);
    }
  }
}
const sharedAdmission = new AuthorityCoordinatorAdmission();
const scopeSchema = NativeFenceEvidenceSchema.pick({
  environmentId: true,
  sessionId: true,
  migrationId: true,
});
const contextSchema = scopeSchema.extend({
  sourceProfileId: IdentifierSchema,
  sourceStoreId: IdentifierSchema,
  nativeActorId: IdentifierSchema,
  challenge: IdentifierSchema,
});
const MAX_BYTES = 32 * 1024 * 1024;
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function immutable<T>(value: T): T {
  const pending: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (pending.length) {
    const next = pending.pop()!;
    if (++nodes > 1_000_000 || next.depth > 128)
      throw new AuthorityCoordinatorBlockedError("Authority snapshot exceeds structural bounds");
    if (
      typeof next.value === "number" &&
      (!Number.isFinite(next.value) ||
        Object.is(next.value, -0) ||
        (Number.isInteger(next.value) && !Number.isSafeInteger(next.value)))
    )
      throw new AuthorityCoordinatorBlockedError("Authority snapshot contains an unsafe number");
    if (next.value && typeof next.value === "object") {
      const array = Array.isArray(next.value);
      if (
        seen.has(next.value) ||
        Object.getPrototypeOf(next.value) !== (array ? Array.prototype : Object.prototype)
      )
        throw new AuthorityCoordinatorBlockedError(
          "Authority snapshot contains unsupported object references",
        );
      seen.add(next.value);
      const descriptors = Object.getOwnPropertyDescriptors(next.value);
      if (
        Object.getOwnPropertySymbols(next.value).length ||
        (array && Object.keys(descriptors).length !== (next.value as unknown[]).length + 1) ||
        Object.entries(descriptors).some(([key, descriptor]) => {
          if (array && key === "length") return false;
          return (
            !Object.hasOwn(descriptor, "value") ||
            !descriptor.enumerable ||
            (array &&
              (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= (next.value as unknown[]).length))
          );
        })
      )
        throw new AuthorityCoordinatorBlockedError(
          "Authority snapshot contains properties that JSON cannot preserve",
        );
      for (const child of Object.values(next.value))
        pending.push({ value: child, depth: next.depth + 1 });
      Object.freeze(next.value);
    } else if (
      next.value !== null &&
      !["string", "number", "boolean"].includes(typeof next.value)
    ) {
      throw new AuthorityCoordinatorBlockedError("Authority snapshot contains a non-JSON value");
    }
  }
  return value;
}
function decimal(token: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token);
  if (!match || token.length > 128)
    throw new AuthorityCoordinatorBlockedError("Unsupported authority snapshot number");
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) return "0";
  let exponent = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent))
    throw new AuthorityCoordinatorBlockedError("Unsupported authority snapshot exponent");
  while (digits.endsWith("0")) {
    digits = digits.slice(0, -1);
    exponent++;
  }
  return `${match[1]}${digits}e${exponent}`;
}
function parseSource(sourceJson: string): ImmutableJson {
  // Compare lexical decimal values before JSON.parse can round an integer,
  // erase a tiny non-zero number, or truncate an over-precise decimal.
  const tokens = /"(?:\\.|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  for (const match of sourceJson.matchAll(tokens)) {
    const token = match[0];
    if (token.startsWith('"')) continue;
    const number = Number(token);
    if (
      !Number.isFinite(number) ||
      Object.is(number, -0) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number)) ||
      decimal(token) !== decimal(JSON.stringify(number))
    )
      throw new AuthorityCoordinatorBlockedError(
        "Authority snapshot number cannot be converted without loss",
      );
  }
  return immutable(JSON.parse(sourceJson) as JsonValue) as ImmutableJson;
}

/** Source seam only: no route/capability is installed until the bridge is qualified. */
export class HostAuthorityCoordinator {
  readonly scope: Readonly<AuthorityScope>;
  private readonly expected: number;
  private readonly challenges = new Set<string>();
  private readonly converter: AuthoritySnapshotConverter;
  private readonly admission: AuthorityCoordinatorAdmission;
  private readonly journal: Journal;
  private readonly native: AuthenticatedNativeAuthorityPort;

  constructor(options: {
    scope: AuthorityScope;
    expectedSourceGeneration: number;
    journal: Journal;
    native: AuthenticatedNativeAuthorityPort;
    converter: AuthoritySnapshotConverter;
    admission?: AuthorityCoordinatorAdmission;
  }) {
    this.scope = Object.freeze(scopeSchema.parse(options.scope));
    // Reserve both the fence increment and an explicit abort's higher floor.
    this.expected = SafeCounterSchema.max(Number.MAX_SAFE_INTEGER - 2).parse(
      options.expectedSourceGeneration,
    );
    IdentifierSchema.parse(options.converter?.version);
    if (typeof options.converter.convert !== "function")
      throw new AuthorityCoordinatorBlockedError("Authority conversion is unavailable");
    for (const method of [
      "authenticatedContext",
      "cancelQuiesce",
      "readFenceSnapshot",
      "quiesceAndFence",
      "verifyHostDecision",
      "applyVerifiedDecision",
      "readDecisionAcknowledgement",
    ] as const)
      if (typeof options.native?.[method] !== "function")
        throw new AuthorityCoordinatorBlockedError("Authenticated native authority is unavailable");
    for (const method of ["status", "prepare", "stage", "activate", "abort", "ack"] as const)
      if (typeof options.journal?.[method] !== "function")
        throw new AuthorityCoordinatorBlockedError(
          "Permanent Host authority journal is unavailable",
        );
    this.converter = Object.freeze({
      version: options.converter.version,
      convert: options.converter.convert.bind(options.converter),
    });
    this.journal = options.journal;
    this.native = options.native;
    this.admission = options.admission ?? sharedAdmission;
  }
  migrate(): Promise<AuthorityCoordinationResult> {
    return this.run("migrate");
  }
  recover(): Promise<AuthorityCoordinationResult> {
    return this.run("recover");
  }
  abort(): Promise<AuthorityCoordinationResult> {
    return this.run("abort");
  }
  cancelBeforeFence(): Promise<NativeQuiesceCancellation> {
    return this.admission.run(this.scope, async () => {
      // An unreadable journal blocks cancellation; any retained Host row proves fencing.
      if (await this.journal.status(this.scope))
        throw new AuthorityCoordinatorBlockedError(
          "A retained Host migration requires permanent decision recovery or abort",
        );
      const context = await this.context("cancel-quiesce");
      const result = await this.native.cancelQuiesce(this.expected, context);
      if (result?.kind === "fenced") {
        this.snapshot(result.snapshot);
        throw new AuthorityCoordinatorBlockedError(
          "Native source is fenced; use permanent Host abort or recovery",
        );
      }
      if (result?.kind !== "cancelled")
        throw new AuthorityCoordinatorBlockedError("Native cancellation outcome is unknown");
      const receipt = NativeQuiesceCancellationSchema.parse(result.receipt);
      if (
        receipt.environmentId !== this.scope.environmentId ||
        receipt.sessionId !== this.scope.sessionId ||
        receipt.migrationId !== this.scope.migrationId ||
        receipt.sourceGeneration !== this.expected ||
        receipt.authorityGeneration !== this.expected + 1 ||
        receipt.identity.sourceStoreId !== context.sourceStoreId ||
        receipt.identity.sourceProfileId !== context.sourceProfileId
      )
        throw new AuthorityCoordinatorBlockedError(
          "Native cancellation receipt scope or generation changed",
        );
      return Object.freeze(receipt);
    });
  }

  private async context(
    step: AuthorityCoordinatorStep,
    fence?: NativeFenceEvidence,
  ): Promise<AuthorityRequestContext> {
    const context = contextSchema.parse(await this.native.authenticatedContext(this.scope, step));
    if (
      ["environmentId", "sessionId", "migrationId"].some(
        (key) => context[key as keyof AuthorityScope] !== this.scope[key as keyof AuthorityScope],
      ) ||
      (fence &&
        (context.sourceProfileId !== fence.sourceProfileId ||
          context.sourceStoreId !== fence.sourceStoreId))
    )
      throw new AuthorityCoordinatorBlockedError(
        "Native actor belongs to a different authority scope",
      );
    const challenge = JSON.stringify([context.nativeActorId, context.challenge]);
    if (this.challenges.has(challenge) || this.challenges.size >= 256)
      throw new AuthorityCoordinatorBlockedError(
        "Native authority requires a fresh authenticated challenge",
      );
    this.challenges.add(challenge);
    return Object.freeze(context);
  }
  private snapshot(
    raw: NativeAuthoritySnapshot,
    prior?: NativeFenceEvidence,
  ): NativeAuthoritySnapshot {
    const fence = NativeFenceEvidenceSchema.parse(raw.fence);
    if (
      ["environmentId", "sessionId", "migrationId"].some(
        (key) => fence[key as keyof AuthorityScope] !== this.scope[key as keyof AuthorityScope],
      ) ||
      fence.generation !== this.expected + 1 ||
      (prior && JSON.stringify(fence) !== JSON.stringify(NativeFenceEvidenceSchema.parse(prior)))
    )
      throw new AuthorityCoordinatorBlockedError(
        "Native fence scope or expected generation changed",
      );
    const sourceJson = raw.sourceJson;
    if (
      typeof sourceJson !== "string" ||
      Buffer.byteLength(sourceJson, "utf8") > MAX_BYTES ||
      Buffer.from(sourceJson, "utf8").toString("utf8") !== sourceJson ||
      hash(sourceJson) !== fence.sourceDigest
    )
      throw new AuthorityCoordinatorBlockedError(
        "Native source bytes do not match their durable fence",
      );
    return Object.freeze({ fence: immutable(fence), sourceJson });
  }
  private stage(snapshot: NativeAuthoritySnapshot): Omit<AuthorityStage, "targetDigest"> {
    const source = parseSource(snapshot.sourceJson);
    const converted = this.converter.convert(source, snapshot.fence);
    immutable(converted);
    if (
      converted.authorityGeneration !== undefined &&
      converted.authorityGeneration !== snapshot.fence.generation
    )
      throw new AuthorityCoordinatorBlockedError("Converted target authority generation changed");
    const normalizedSnapshot = immutable({
      ...converted,
      authorityGeneration: snapshot.fence.generation,
    });
    if (Buffer.byteLength(JSON.stringify(normalizedSnapshot), "utf8") > MAX_BYTES)
      throw new AuthorityCoordinatorBlockedError(
        "Converted authority snapshot exceeds its byte limit",
      );
    return Object.freeze({
      ...snapshot,
      normalizedSnapshot,
      converterVersion: this.converter.version,
    });
  }
  private decision(raw: HostAuthorityDecision, fence: NativeFenceEvidence): HostAuthorityDecision {
    const decision = HostAuthorityDecisionSchema.parse(raw);
    if (
      hash(hostAuthorityDecisionDigestInput(decision)) !== decision.decisionDigest ||
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
      (decision.phase === "host-active"
        ? decision.authorityGeneration !== fence.generation
        : decision.authorityGeneration <= fence.generation)
    )
      throw new AuthorityCoordinatorBlockedError(
        "Permanent Host authority decision does not match the source fence",
      );
    return immutable(decision);
  }
  private async settle(status: AuthorityStatus): Promise<AuthorityCoordinationResult> {
    if (!status.decision)
      throw new AuthorityCoordinatorBlockedError("Host authority has no permanent decision");
    const fence = NativeFenceEvidenceSchema.parse(status.fence);
    if (
      fence.generation !== this.expected + 1 ||
      ["environmentId", "sessionId", "migrationId"].some(
        (key) => fence[key as keyof AuthorityScope] !== this.scope[key as keyof AuthorityScope],
      )
    )
      throw new AuthorityCoordinatorBlockedError(
        "Permanent authority decision belongs to a different migration",
      );
    const decision = this.decision(status.decision, fence);
    if (status.phase !== decision.phase)
      throw new AuthorityCoordinatorBlockedError(
        "Host authority phase differs from its permanent decision",
      );
    if (status.acknowledged) return { decision, status };
    const handle = await this.native.verifyHostDecision(
      decision,
      await this.context("verify-decision", fence),
    );
    if (!handle || typeof handle !== "object" || Array.isArray(handle))
      throw new AuthorityCoordinatorBlockedError(
        "Native decision verification did not return a native-owned handle",
      );
    await this.native.applyVerifiedDecision(handle, await this.context("apply-decision", fence));
    const acknowledgement = this.decision(
      await this.native.readDecisionAcknowledgement(
        decision,
        await this.context("read-native-ack", fence),
      ),
      fence,
    );
    if (
      acknowledgement.decisionDigest !== decision.decisionDigest ||
      hostAuthorityDecisionDigestInput(acknowledgement) !==
        hostAuthorityDecisionDigestInput(decision)
    )
      throw new AuthorityCoordinatorBlockedError(
        "Native durable acknowledgement differs from the permanent Host decision",
      );
    const acknowledged = await this.journal.ack(
      fence,
      decision.decisionDigest,
      await this.context("host-ack", fence),
    );
    if (
      !acknowledged.acknowledged ||
      !acknowledged.decision ||
      acknowledged.decision.decisionDigest !== decision.decisionDigest
    )
      throw new AuthorityCoordinatorBlockedError(
        "Host acknowledgement did not preserve its permanent decision",
      );
    return { decision, status: acknowledged };
  }
  private run(mode: "migrate" | "recover" | "abort"): Promise<AuthorityCoordinationResult> {
    return this.admission.run(this.scope, async () => {
      // Status read errors propagate. No native unfreeze or guessed decision is
      // permitted when the authoritative journal cannot answer.
      let status = await this.journal.status(this.scope);
      if (status?.decision) return this.settle(status);
      let raw = await this.native.readFenceSnapshot(
        await this.context("read-snapshot", status?.fence),
      );
      if (!raw) {
        if (mode === "recover" || mode === "abort")
          throw new AuthorityCoordinatorBlockedError(
            "Native recovery requires its retained durable source snapshot",
          );
        raw = await this.native.quiesceAndFence(this.expected, await this.context("fence"));
      }
      const snapshot = this.snapshot(raw, status?.fence);
      try {
        status = await this.journal.prepare(
          snapshot.fence,
          await this.context("prepare", snapshot.fence),
        );
        if (!status.decision && mode !== "abort") {
          if (status.converterVersion && status.converterVersion !== this.converter.version)
            throw new AuthorityCoordinatorBlockedError(
              "Recovery requires the original immutable converter version",
            );
          status = await this.journal.stage(
            this.stage(snapshot),
            await this.context("stage", snapshot.fence),
          );
        }
        if (!status.decision) {
          const decision =
            mode === "abort"
              ? await this.journal.abort(
                  snapshot.fence,
                  await this.context("abort", snapshot.fence),
                )
              : await this.journal.activate(
                  snapshot.fence,
                  await this.context("activate", snapshot.fence),
                );
          status = { ...status, phase: decision.phase, decision, acknowledged: false };
        }
      } catch (error) {
        // Reconcile once, never retry activation or manufacture an abort. A
        // concurrent/opposite permanent decision dominates this caller's intent.
        const permanent = await this.journal.status(this.scope);
        if (!permanent?.decision) throw error;
        status = permanent;
      }
      // Native verification/application/acknowledgement are outside journal
      // reconciliation: an interrupted native step remains explicitly recoverable,
      // never silently re-issued by this operation's error handler.
      return this.settle(status);
    });
  }
}
