import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { z } from "zod";
import { getSessions, subscribeSessionCommits } from "../model/sessionsStore";
import type { Session } from "../model/session";
import { beginComposerClosure } from "./composerClosure";
import {
  encodeNativeRawCapture,
  NativeRawCaptureError,
  NATIVE_RAW_CAPTURE_LIMITS,
} from "./nativeRawCapture";
import { NativeCaptureJsonError } from "../../../shared/lib/native-capture-json";
import { encodeNativeProducerCapture } from "./nativeProducerCapture";
import {
  beginNativeProducerInputClosure,
  type NativeProducerInputLease,
  type NativeProducerInputClosure,
  type NativeProducerInputClosureOptions,
} from "./mountedInputCapture";
import {
  rendererPersistenceDrain,
  type PersistenceDrainAttempt,
  type PersistenceDrainRegistry,
  type PersistenceScope,
} from "./persistenceDrain";
import {
  flushSessionWritesStrict,
  isPersistableId,
  shouldPersistSession,
  upsertSession,
} from "./sessionStore";
import { inspectNativeOutputDelivery } from "../../../integrations/harness/core/nativeOutputDelivery";
import {
  getSessionOutputFullCandidate,
  getSessionOutputFullCandidateComparison,
  sameSessionOutputLifetime,
  subscribePendingSessionOutput,
  type SessionOutputFullCandidate,
  type SessionOutputFullCandidateComparison,
} from "./sessionOutputProjection";

const uuid = z
  .string()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
const identity = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => {
    for (const character of value) {
      const code = character.codePointAt(0)!;
      if (code < 32 || (code >= 127 && code <= 159)) return false;
    }
    return true;
  });
const scopeFields = {
  version: z.literal(1),
  qualified: z.literal(false),
  prepareId: uuid,
  environmentId: identity,
  sessionId: identity,
  migrationId: identity,
  generation: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  windowEpoch: uuid,
  expiresInMs: z.number().int().min(1).max(30_000),
};
const prepareSchema = z.strictObject(scopeFields);
const challengeSchema = z.strictObject({
  ...scopeFields,
  nonce: uuid,
  roundId: uuid,
});
const finishedSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  prepareId: uuid,
  status: z.enum(["observed", "cancelled", "unverified"]),
  reason: z.string().max(4096).optional(),
});
const hash = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
// Parse only diagnostic data from the private same-round Native status owner.
// Its SQL metadata never supplies a caller grant or a verification outcome.
const rawStatusSchema = z.strictObject({
  version: z.literal(1),
  qualified: z.literal(false),
  status: z.enum(["retained", "pending", "unknown"]),
  receipt: z
    .strictObject({
      version: z.literal(1),
      sql: z
        .object({
          version: z.literal(1),
          qualified: z.literal(false),
          nonce: uuid,
          roundId: uuid,
          windowEpoch: uuid,
          environmentId: identity,
          sessionId: identity,
          migrationId: identity,
          generation: counter,
          rawCapture: z.strictObject({
            version: z.literal(1),
            sha256: hash,
            byteLength: counter.min(1).max(NATIVE_RAW_CAPTURE_LIMITS.bytes),
            snapshotCount: counter.max(NATIVE_RAW_CAPTURE_LIMITS.snapshots),
            comparisonSha256: hash,
          }),
        })
        .passthrough(),
    })
    .optional(),
});
export type NativeProjectionPrepare = Readonly<z.infer<typeof prepareSchema>>;
export type NativeProjectionChallenge = Readonly<
  z.infer<typeof challengeSchema>
>;
export const NATIVE_PROJECTION_CHECKPOINT_LIMITS = Object.freeze({
  retainedPrepares: 4,
  seenPrepareIds: 256,
  comparisonJsonBytes: 2 * 1024 * 1024,
  maxLifetimeMs: 30_000,
  candidatePollMs: 10,
  rawStatusMs: 250,
});
export const NATIVE_PROJECTION_MISSING_COVERAGE = Object.freeze([
  "raw-editor-buffers",
  "multi-input-provenance",
  "provider-closure",
  "producer-coverage",
  "notes-input-coverage",
  "host-notes-writer-closure",
]);
type Closure = {
  captureAndFlush(): Promise<{ readonly missingCoverage: readonly string[] }>;
  assertCurrent(): void;
  reopen(owner: object): void;
};
type ClosureOptions = { owner: object; timeoutMs: number; signal: AbortSignal };
type NativeInvoke = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;
export type NativeProjectionCheckpointOptions = {
  invoke?: NativeInvoke;
  sessions?: () => readonly Session[];
  drain?: PersistenceDrainRegistry;
  mountedBegin?: (scope: PersistenceScope, options: ClosureOptions) => Closure;
  /** Supply only from the actual Quick window composition. Never create a fake Quick state. */
  quickBegin?: (options: ClosureOptions) => Closure;
  flush?: (scope: PersistenceScope) => Promise<void>;
  save?: (session: Session) => Promise<unknown>;
  beginInputs?: (
    sessionId: string,
    options: NativeProducerInputClosureOptions,
  ) => NativeProducerInputClosure;
};
class CheckpointError extends Error {
  constructor(readonly code: string) {
    super(`Native projection preparation unavailable: ${code}`);
  }
}
type Entry = {
  scope: NativeProjectionPrepare;
  owner: object;
  deadline: number;
  controller: AbortController;
  interrupt: Promise<never>;
  reject(reason: unknown): void;
  timer: ReturnType<typeof setTimeout>;
  jobs: number;
  released: boolean;
  releaseRequested: boolean;
  phase: "preparing" | "prepared" | "verifying" | "releasing";
  baseline?: Session;
  target?: Session;
  candidate?: SessionOutputFullCandidate;
  comparisonJson?: string;
  rawCapture?: Awaited<ReturnType<Closure["captureAndFlush"]>>;
  rawCaptureJson?: string;
  producerInputs?: NativeProducerInputLease;
  inputAdmission?: NativeProducerInputClosure;
  rawStatusQueried?: boolean;
  retainedRaw?: boolean;
  closure?: Closure;
  drain?: PersistenceDrainAttempt;
  missing: readonly string[];
  sentStatus?: "prepared" | "busy" | "unverified";
  prepareTask?: Promise<void>;
  challenge?: NativeProjectionChallenge;
  verifyTask?: Promise<void>;
  releaseTask?: Promise<void>;
};
const sameScope = (a: NativeProjectionPrepare, b: NativeProjectionPrepare) =>
  a.prepareId === b.prepareId &&
  a.environmentId === b.environmentId &&
  a.sessionId === b.sessionId &&
  a.migrationId === b.migrationId &&
  a.generation === b.generation &&
  a.windowEpoch === b.windowEpoch;
const installedDisposers = new Set<() => Promise<void>>();
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const dispose of installedDisposers) void dispose();
  });

/** Native events consume private issued rounds; this service has no Native begin API.
 * Portable candidate data remains unqualified and never closes unsupported producers. */
export function createNativeProjectionCheckpointService(
  options: NativeProjectionCheckpointOptions = {},
) {
  const nativeInvoke =
    options.invoke ?? ((command, args) => invoke(command, args));
  const sessions = options.sessions ?? getSessions;
  const registry = options.drain ?? rendererPersistenceDrain;
  const flush = options.flush ?? flushSessionWritesStrict;
  const save = options.save ?? upsertSession;
  const mountedBegin = options.mountedBegin ?? beginComposerClosure;
  const entries = new Map<string, Entry>();
  const seen = new Set<string>();
  const idle = new Set<() => void>();
  let stopping = false;
  let stopObservers = () => {};
  let disposeTask: Promise<void> | undefined;
  function collect(entry: Entry) {
    if (!entry.released || entry.jobs) return;
    if (entries.get(entry.scope.prepareId) === entry)
      entries.delete(entry.scope.prepareId);
    if (!entries.size) {
      for (const done of idle) done();
      idle.clear();
      if (stopping) stopObservers();
    }
  }
  /** Charge before invoking a factory; cancellation never settles this actual promise. */
  function actual<T>(
    entry: Entry,
    operation: () => T | Promise<T>,
  ): Promise<T> {
    entry.jobs++;
    let result: Promise<T>;
    try {
      result = Promise.resolve(operation());
    } catch (error) {
      result = Promise.reject(error);
    }
    return result.then(
      (value) => {
        entry.jobs--;
        collect(entry);
        return value;
      },
      (error: unknown) => {
        entry.jobs--;
        collect(entry);
        throw error;
      },
    );
  }
  const wait = <T>(entry: Entry, promise: Promise<T>) =>
    Promise.race([promise, entry.interrupt]);
  function current(id: string): Session {
    const matches = sessions().filter((session) => session.id === id);
    if (
      matches.length !== 1 ||
      !isPersistableId(id) ||
      !shouldPersistSession(matches[0])
    )
      throw new CheckpointError("session-unavailable");
    return matches[0];
  }
  function assertOpen(entry: Entry): void {
    if (entry.released || entry.releaseRequested || stopping)
      throw new CheckpointError("cancelled");
    if (performance.now() >= entry.deadline)
      throw new CheckpointError("deadline");
  }
  function assertEntry(entry: Entry): Session {
    assertOpen(entry);
    const session = current(entry.scope.sessionId);
    if (session.busy) throw new CheckpointError("busy-session");
    if (entry.baseline && !sameSessionOutputLifetime(entry.baseline, session))
      throw new CheckpointError("model-replaced");
    return session;
  }
  function comparison(
    entry: Entry,
  ): SessionOutputFullCandidateComparison | null {
    const session = assertEntry(entry);
    if (entry.target && session !== entry.target)
      throw new CheckpointError("model-changed");
    if (
      !entry.candidate ||
      getSessionOutputFullCandidate(session) !== entry.candidate
    )
      return null;
    const result = getSessionOutputFullCandidateComparison(entry.candidate);
    if (!result) {
      const negative = inspectNativeOutputDelivery(session.id);
      if (
        negative.retentionUnavailable ||
        negative.streams.some((stream) => stream.unavailableReason !== null)
      )
        throw new CheckpointError("candidate-unavailable");
      return null;
    }
    if (
      result.sessionId !== entry.scope.sessionId ||
      !result.items.length ||
      result.items.some(
        (item) =>
          (item.batch.logicalSessionId ?? item.batch.sessionId) !==
            entry.scope.sessionId ||
          item.batch.ownerEpoch !== entry.scope.windowEpoch,
      )
    )
      throw new CheckpointError("item-scope-changed");
    return result;
  }
  function encode(value: SessionOutputFullCandidateComparison): string {
    const json = JSON.stringify(value);
    if (
      new TextEncoder().encode(json).byteLength >
      NATIVE_PROJECTION_CHECKPOINT_LIMITS.comparisonJsonBytes
    )
      throw new CheckpointError("comparison-capacity");
    return json;
  }
  function assertPrepared(entry: Entry): string {
    entry.closure?.assertCurrent();
    entry.drain?.assertCurrent();
    if (
      !entry.rawCaptureJson ||
      !entry.inputAdmission?.current() ||
      !entry.producerInputs?.current() ||
      encodeNativeProducerCapture(
        entry.scope.sessionId,
        entry.rawCapture,
        entry.producerInputs,
      ) !== entry.rawCaptureJson
    )
      throw new CheckpointError("raw-capture-changed");
    const claim = comparison(entry);
    if (!claim || encode(claim) !== entry.comparisonJson)
      throw new CheckpointError("candidate-changed");
    return entry.comparisonJson!;
  }
  function reopen(entry: Entry) {
    if (entry.released) return;
    entry.released = true;
    clearTimeout(entry.timer);
    entry.reject(new CheckpointError("cancelled"));
    entry.controller.abort();
    entry.drain?.abandon();
    entry.producerInputs?.release();
    entry.inputAdmission?.release();
    entry.closure?.reopen(entry.owner);
    collect(entry);
  }
  function requestRelease(entry: Entry, reason: string): Promise<void> {
    if (entry.released) return Promise.resolve();
    if (entry.releaseRequested) return entry.releaseTask ?? Promise.resolve();
    entry.releaseRequested = true;
    entry.phase = "releasing";
    entry.reject(new CheckpointError(reason));
    entry.controller.abort();
    // A false/unknown response retains this exact owner and finished receiver.
    const pending = actual(entry, () =>
      nativeInvoke("native_projection_checkpoint_release", {
        prepareId: entry.scope.prepareId,
        reason,
      }),
    ).then(
      (result) => {
        if (
          result &&
          typeof result === "object" &&
          "releaseReady" in result &&
          result.releaseReady === true
        )
          reopen(entry);
      },
      () => {},
    );
    entry.releaseTask = pending;
    return pending;
  }
  async function publish(
    entry: Entry,
    status: "prepared" | "busy" | "unverified",
  ) {
    if (entry.sentStatus || entry.released) return;
    entry.sentStatus = status;
    await actual(entry, () =>
      nativeInvoke("native_projection_checkpoint_prepared", {
        prepareId: entry.scope.prepareId,
        windowEpoch: entry.scope.windowEpoch,
        status,
        ...(status === "prepared"
          ? {
              comparisonJson: entry.comparisonJson,
              rawCaptureJson: entry.rawCaptureJson,
            }
          : {}),
        missingCoverage: entry.missing,
      }),
    );
  }
  async function observeRawAfterRejectedVerify(
    entry: Entry,
    challenge: NativeProjectionChallenge,
  ) {
    const cutoff = Math.min(
      entry.deadline,
      performance.now() + NATIVE_PROJECTION_CHECKPOINT_LIMITS.rawStatusMs,
    );
    const stillOwned = () =>
      !stopping &&
      !entry.released &&
      !entry.releaseRequested &&
      entries.get(entry.scope.prepareId) === entry &&
      performance.now() < cutoff;
    if (entry.rawStatusQueried || !stillOwned()) return;
    try {
      assertPrepared(entry);
    } catch {
      return;
    }
    if (!stillOwned()) return;
    entry.rawStatusQueried = true;
    const task = actual(entry, async () => {
      const result = await nativeInvoke(
        "native_projection_checkpoint_raw_status",
        {
          prepareId: challenge.prepareId,
          nonce: challenge.nonce,
          comparisonJson: entry.comparisonJson,
          rawCaptureJson: entry.rawCaptureJson,
        },
      );
      if (!stillOwned()) return;
      const parsed = rawStatusSchema.safeParse(result);
      if (
        !parsed.success ||
        parsed.data.status !== "retained" ||
        !parsed.data.receipt
      )
        return;
      const sql = parsed.data.receipt.sql;
      if (
        sql.nonce !== challenge.nonce ||
        sql.roundId !== challenge.roundId ||
        sql.windowEpoch !== entry.scope.windowEpoch ||
        sql.environmentId !== entry.scope.environmentId ||
        sql.sessionId !== entry.scope.sessionId ||
        sql.migrationId !== entry.scope.migrationId ||
        sql.generation !== entry.scope.generation
      )
        return;
      const raw = new TextEncoder().encode(entry.rawCaptureJson!);
      const comparison = new TextEncoder().encode(entry.comparisonJson!);
      const digests = await Promise.all([
        crypto.subtle.digest("SHA-256", raw),
        crypto.subtle.digest("SHA-256", comparison),
      ]);
      const hex = (bytes: ArrayBuffer) =>
        Array.from(new Uint8Array(bytes), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("");
      const snapshots = Object.getOwnPropertyDescriptor(
        entry.rawCapture,
        "snapshots",
      )?.value as unknown[];
      if (
        !stillOwned() ||
        sql.rawCapture.byteLength !== raw.byteLength ||
        sql.rawCapture.snapshotCount !==
          snapshots.length +
            (entry.producerInputs?.parent.snapshots.length ?? 0) +
            (entry.producerInputs?.editor.snapshots.length ?? 0) +
            (entry.producerInputs?.notes?.snapshots.length ?? 0) ||
        sql.rawCapture.sha256 !== hex(digests[0]!) ||
        sql.rawCapture.comparisonSha256 !== hex(digests[1]!)
      )
        return;
      assertPrepared(entry);
      entry.retainedRaw = true;
    }).then(
      () => {},
      () => {},
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await wait(
        entry,
        Promise.race([
          task,
          new Promise<void>((done) => {
            timer = setTimeout(done, Math.max(0, cutoff - performance.now()));
          }),
        ]),
      );
    } catch {
      // Cancellation or an unknown read never supplies another write attempt.
    } finally {
      clearTimeout(timer);
    }
  }
  async function candidate(entry: Entry) {
    let session = assertEntry(entry);
    let token = getSessionOutputFullCandidate(session);
    if (!token) {
      // One actual replacement only. Never retry a rejected/unknown write or provider effect.
      await wait(
        entry,
        actual(entry, () => save(session)),
      );
      session = assertEntry(entry);
      token = getSessionOutputFullCandidate(session);
    }
    if (!token) throw new CheckpointError("candidate-unavailable");
    entry.target = session;
    entry.candidate = token;
    while (true) {
      const claim = comparison(entry);
      if (claim) return encode(claim);
      await wait(
        entry,
        new Promise<void>((resolve) =>
          setTimeout(
            resolve,
            NATIVE_PROJECTION_CHECKPOINT_LIMITS.candidatePollMs,
          ),
        ),
      );
    }
  }
  async function prepare(entry: Entry) {
    try {
      let session: Session | undefined;
      try {
        session = current(entry.scope.sessionId);
      } catch (error) {
        // Sessionless Quick still owns real prompt/options/preparation work.
        // Capture it honestly, without manufacturing a target model or save.
        if (!options.quickBegin) throw error;
      }
      entry.baseline = session;
      if (session?.busy) {
        await publish(entry, "busy");
        reopen(entry);
        return;
      }
      if (session) assertEntry(entry);
      else assertOpen(entry);
      const config = {
        owner: entry.owner,
        signal: entry.controller.signal,
        timeoutMs: Math.min(
          30_000,
          Math.max(1, Math.ceil(entry.deadline - performance.now())),
        ),
      };
      entry.inputAdmission = (
        options.beginInputs ?? beginNativeProducerInputClosure
      )(entry.scope.sessionId, config);
      if (!entry.inputAdmission.current())
        throw new CheckpointError("input-admission-unavailable");
      entry.closure = options.quickBegin
        ? options.quickBegin(config)
        : mountedBegin([entry.scope.sessionId], config);
      const captured = await wait(
        entry,
        actual(entry, () => entry.closure!.captureAndFlush()),
      );
      assertOpen(entry);
      entry.missing = Object.freeze(
        [
          ...new Set([
            ...NATIVE_PROJECTION_MISSING_COVERAGE,
            ...captured.missingCoverage,
          ]),
        ].sort(),
      );
      if (!session) throw new CheckpointError("session-unavailable");
      assertEntry(entry);
      // Keep the existing pre-save rejection of an oversized Composer capture.
      // The combined producer envelope is encoded after the actual drain.
      encodeNativeRawCapture(entry.scope.sessionId, captured);
      entry.rawCapture = captured;
      await wait(
        entry,
        actual(entry, () => flush([session.id])),
      );
      assertEntry(entry);
      entry.comparisonJson = await candidate(entry);
      entry.closure.assertCurrent();
      entry.drain = registry.beginAttempt([session.id], {
        signal: entry.controller.signal,
        timeoutMs: Math.max(1, Math.ceil(entry.deadline - performance.now())),
      });
      await wait(
        entry,
        actual(entry, () => entry.drain!.observe()),
      );
      await wait(
        entry,
        actual(entry, async () => {
          const capturedInputs = await entry.inputAdmission!.capture();
          if (entry.released || entry.releaseRequested || stopping) {
            capturedInputs.release();
            throw new CheckpointError("cancelled");
          }
          entry.producerInputs = capturedInputs;
        }),
      );
      entry.rawCaptureJson = encodeNativeProducerCapture(
        entry.scope.sessionId,
        captured,
        entry.producerInputs!,
      );
      entry.missing = Object.freeze(
        [
          ...new Set([
            ...entry.missing,
            ...entry.producerInputs!.missingCoverage,
          ]),
        ].sort(),
      );
      assertPrepared(entry);
      entry.phase = "prepared";
      await wait(entry, publish(entry, "prepared"));
      if (!entry.released && !entry.releaseRequested) assertPrepared(entry);
    } catch (error) {
      if (entry.released || entry.releaseRequested) return;
      const reason =
        error instanceof CheckpointError
          ? error.code
          : error instanceof NativeRawCaptureError
            ? `raw-capture-${error.code}`
            : error instanceof NativeCaptureJsonError
              ? `producer-capture-${error.code}`
              : "preparation-unverified";
      entry.missing = Object.freeze(
        [...new Set([...entry.missing, reason])].sort(),
      );
      if (!entry.sentStatus) {
        try {
          await publish(entry, "unverified");
        } catch {
          /* Unknown response is reconciled only by release/finished. */
        }
      }
      await requestRelease(entry, reason);
    }
  }
  function changed() {
    for (const entry of entries.values()) {
      if (entry.released || entry.releaseRequested || !entry.baseline) continue;
      try {
        assertEntry(entry);
        if (entry.comparisonJson) assertPrepared(entry);
      } catch {
        void requestRelease(entry, "model-changed");
      }
    }
  }
  const stopModel = subscribeSessionCommits(changed);
  const stopOutput = subscribePendingSessionOutput(changed);
  stopObservers = () => {
    stopModel();
    stopOutput();
  };
  return {
    handlePrepare(payload: unknown): Promise<void> {
      const parsed = prepareSchema.safeParse(payload);
      if (!parsed.success || stopping) return Promise.resolve();
      const scope = Object.freeze(parsed.data);
      const previous = entries.get(scope.prepareId);
      if (previous)
        return sameScope(previous.scope, scope)
          ? (previous.prepareTask ?? Promise.resolve())
          : Promise.resolve();
      if (
        seen.has(scope.prepareId) ||
        seen.size >= NATIVE_PROJECTION_CHECKPOINT_LIMITS.seenPrepareIds ||
        entries.size >= NATIVE_PROJECTION_CHECKPOINT_LIMITS.retainedPrepares ||
        [...entries.values()].some(
          (entry) =>
            !entry.released && entry.scope.sessionId === scope.sessionId,
        )
      )
        return Promise.resolve();
      seen.add(scope.prepareId);
      let reject!: Entry["reject"];
      const interrupt = new Promise<never>((_, fail) => {
        reject = fail;
      });
      void interrupt.catch(() => {});
      const entry: Entry = {
        scope,
        owner: {},
        deadline: performance.now() + scope.expiresInMs,
        controller: new AbortController(),
        interrupt,
        reject,
        timer: undefined!,
        jobs: 0,
        released: false,
        releaseRequested: false,
        phase: "preparing",
        missing: NATIVE_PROJECTION_MISSING_COVERAGE,
      };
      entries.set(scope.prepareId, entry);
      entry.timer = setTimeout(() => {
        void requestRelease(entry, "deadline");
      }, scope.expiresInMs);
      entry.prepareTask = prepare(entry);
      return entry.prepareTask;
    },
    handleChallenge(payload: unknown): Promise<void> {
      const parsed = challengeSchema.safeParse(payload);
      if (!parsed.success || stopping) return Promise.resolve();
      const challenge = Object.freeze(parsed.data);
      const entry = entries.get(challenge.prepareId);
      if (
        !entry ||
        entry.released ||
        entry.releaseRequested ||
        entry.sentStatus !== "prepared" ||
        !sameScope(entry.scope, challenge)
      )
        return Promise.resolve();
      if (entry.challenge)
        return entry.challenge.nonce === challenge.nonce &&
          entry.challenge.roundId === challenge.roundId
          ? (entry.verifyTask ?? Promise.resolve())
          : Promise.resolve();
      entry.challenge = challenge;
      entry.deadline = Math.min(
        entry.deadline,
        performance.now() + challenge.expiresInMs,
      );
      clearTimeout(entry.timer);
      entry.timer = setTimeout(
        () => {
          void requestRelease(entry, "deadline");
        },
        Math.max(0, entry.deadline - performance.now()),
      );
      entry.phase = "verifying";
      entry.verifyTask = (async () => {
        let actualVerifyRejected = false;
        try {
          const comparisonJson = assertPrepared(entry);
          await wait(
            entry,
            actual(entry, () =>
              nativeInvoke("native_projection_checkpoint_verify", {
                prepareId: challenge.prepareId,
                nonce: challenge.nonce,
                comparisonJson,
                rawCaptureJson: entry.rawCaptureJson,
              }),
            ).catch((error: unknown) => {
              actualVerifyRejected = true;
              throw error;
            }),
          );
          if (!entry.released && !entry.releaseRequested) assertPrepared(entry);
          // Only Native finished/releaseReady confirms that its actual round reopened.
        } catch {
          if (actualVerifyRejected)
            await observeRawAfterRejectedVerify(entry, challenge);
          if (!entry.released)
            await requestRelease(entry, "verification-unverified");
        }
      })();
      return entry.verifyTask;
    },
    handleFinished(payload: unknown): void {
      const parsed = finishedSchema.safeParse(payload);
      if (!parsed.success) return;
      const entry = entries.get(parsed.data.prepareId);
      if (entry) reopen(entry);
    },
    cancel(prepareId: string): Promise<void> {
      const entry = entries.get(prepareId);
      return entry ? requestRelease(entry, "cancelled") : Promise.resolve();
    },
    observation() {
      return Object.freeze({
        qualified: false as const,
        scopeComplete: false as const,
        activePrepares: entries.size,
        actualJobs: [...entries.values()].reduce(
          (sum, entry) => sum + entry.jobs,
          0,
        ),
        releasing: [...entries.values()].filter(
          (entry) => entry.releaseRequested,
        ).length,
        seenPrepareIds: seen.size,
        retainedRaw: [...entries.values()].some(
          (entry) => entry.retainedRaw === true,
        ),
        missingCoverage: NATIVE_PROJECTION_MISSING_COVERAGE,
        limits: NATIVE_PROJECTION_CHECKPOINT_LIMITS,
      });
    },
    dispose(): Promise<void> {
      if (disposeTask) return disposeTask;
      stopping = true;
      for (const entry of entries.values())
        void requestRelease(entry, "renderer-disposed");
      disposeTask = entries.size
        ? new Promise<void>((resolve) => idle.add(resolve))
        : Promise.resolve();
      if (!entries.size) stopObservers();
      return disposeTask;
    },
  };
}

/** Finished/challenge are installed first. Disposal keeps finished delivery alive
 * until Native acknowledges release and every actual accepted operation settles. */
export function installNativeProjectionCheckpointReceiver(
  options: NativeProjectionCheckpointOptions = {},
) {
  const service = createNativeProjectionCheckpointService(options);
  const subscriptions = new Map<string, UnlistenFn>();
  let stopping = false;
  let disposal: Promise<void> | undefined;
  const ready = (async () => {
    // Global event.listen uses Any routing. A prepare for another physical
    // window must never close this window's mounted input or admit local saves.
    const window = getCurrentWebviewWindow();
    for (const [name, callback] of [
      [
        "native-projection-finished",
        (payload: unknown) => service.handleFinished(payload),
      ],
      [
        "native-projection-challenge",
        (payload: unknown) => {
          void service.handleChallenge(payload);
        },
      ],
      [
        "native-projection-prepare",
        (payload: unknown) => {
          void service.handlePrepare(payload);
        },
      ],
    ] as const) {
      const unlisten = await window.listen<unknown>(name, (event) =>
        callback(event.payload),
      );
      if (stopping) {
        unlisten();
        return;
      }
      subscriptions.set(name, unlisten);
    }
  })();
  const dispose = (): Promise<void> => {
    if (disposal) return disposal;
    stopping = true;
    const settled = service.dispose();
    disposal = (async () => {
      await ready.catch(() => {});
      for (const name of [
        "native-projection-prepare",
        "native-projection-challenge",
      ]) {
        subscriptions.get(name)?.();
        subscriptions.delete(name);
      }
      await settled;
      subscriptions.get("native-projection-finished")?.();
      subscriptions.clear();
      installedDisposers.delete(dispose);
    })();
    return disposal;
  };
  installedDisposers.add(dispose);
  void ready.catch(() => {
    void dispose();
  });
  return { service, ready, dispose };
}
