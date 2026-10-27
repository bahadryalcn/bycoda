import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  HostAuthorityDecisionSchema,
  NativeFenceEvidenceSchema,
  hostAuthorityDecisionDigestInput,
  type HostAuthorityDecision,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import type { HostSession } from "../../src/features/connections/model/protocol";
import { HostStore } from "../store";
import {
  HostAuthorityJournal,
  type AuthorityRequestContext,
  type AuthorityScope,
  type AuthorityStage,
} from "./authority-journal";
import {
  AuthorityCoordinatorAdmission,
  AuthorityCoordinatorBusyError,
  HostAuthorityCoordinator,
  type AuthenticatedNativeAuthorityPort,
  type AuthorityCoordinatorStep,
  type AuthoritySnapshotConverter,
  type NativeAuthoritySnapshot,
} from "./authority-coordinator";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
type JournalPort = Pick<
  HostAuthorityJournal,
  "status" | "prepare" | "stage" | "activate" | "abort" | "ack"
>;
function journalPort(
  journal: HostAuthorityJournal,
  overrides: Partial<JournalPort> = {},
): JournalPort {
  return {
    status: journal.status.bind(journal),
    prepare: journal.prepare.bind(journal),
    stage: journal.stage.bind(journal),
    activate: journal.activate.bind(journal),
    abort: journal.abort.bind(journal),
    ack: journal.ack.bind(journal),
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** Synthetic trusted adapter only. This does not qualify real native IPC/writers. */
class FixtureNative implements AuthenticatedNativeAuthorityPort {
  async cancelQuiesce(expected: number, context: AuthorityRequestContext) {
    this.consume(context, "cancel-quiesce");
    await this.hooks["cancel-quiesce"]?.();
    if (this.retained) return { kind: "fenced" as const, snapshot: structuredClone(this.retained) };
    return {
      kind: "cancelled" as const,
      receipt: {
        receiptId: "cancel-receipt",
        ...this.scope,
        identity: {
          sourceStoreId: context.sourceStoreId,
          sourceProfileId: context.sourceProfileId,
        },
        sourceGeneration: expected,
        authorityGeneration: expected + 1,
      },
    };
  }
  readonly events: string[] = [];
  readonly contexts = new Map<string, { step: AuthorityCoordinatorStep; used: boolean }>();
  readonly handles = new WeakMap<object, HostAuthorityDecision>();
  readonly hooks: Partial<Record<AuthorityCoordinatorStep, () => void | Promise<void>>> = {};
  retained?: NativeAuthoritySnapshot;
  durable?: HostAuthorityDecision;
  writer: "native" | "fenced" | "host" = "native";
  qualified = true;
  constructor(
    readonly scope: AuthorityScope,
    public sourceJson: string,
  ) {}
  async authenticatedContext(
    scope: Readonly<AuthorityScope>,
    step: AuthorityCoordinatorStep,
  ): Promise<AuthorityRequestContext> {
    expect(scope).toEqual(this.scope);
    const challenge = randomUUID();
    this.contexts.set(challenge, { step, used: false });
    return {
      ...scope,
      sourceProfileId: "profile",
      sourceStoreId: "native-store",
      nativeActorId: "fixture-native-actor",
      challenge,
    };
  }
  consume(context: AuthorityRequestContext, step?: AuthorityCoordinatorStep) {
    const issued = this.contexts.get(context.challenge);
    if (
      !issued ||
      issued.used ||
      (step && issued.step !== step) ||
      context.nativeActorId !== "fixture-native-actor" ||
      context.sourceProfileId !== "profile" ||
      context.sourceStoreId !== "native-store" ||
      context.environmentId !== this.scope.environmentId ||
      context.sessionId !== this.scope.sessionId ||
      context.migrationId !== this.scope.migrationId
    )
      throw new Error("fixture native authentication/challenge rejected");
    issued.used = true;
    this.events.push(issued.step);
  }
  async readFenceSnapshot(
    context: AuthorityRequestContext,
  ): Promise<NativeAuthoritySnapshot | undefined> {
    this.consume(context, "read-snapshot");
    await this.hooks["read-snapshot"]?.();
    return this.retained && structuredClone(this.retained);
  }
  async quiesceAndFence(
    expectedSourceGeneration: number,
    context: AuthorityRequestContext,
  ): Promise<NativeAuthoritySnapshot> {
    this.consume(context, "fence");
    if (!this.qualified) throw new Error("native window/writer inventory proof missing");
    if (this.retained) throw new Error("fixture must reuse retained fence");
    const fence = NativeFenceEvidenceSchema.parse({
      protocol: 2,
      ...this.scope,
      sourceProfileId: "profile",
      sourceStoreId: "native-store",
      generation: expectedSourceGeneration + 1,
      sourceRevision: 7,
      sourceDigest: hash(this.sourceJson),
      snapshotEncoding: "source-json-utf8/v1",
      minWriterProtocol: 2,
      quiescent: true,
      unknownReservations: false,
      writerInventoryVerified: true,
      unsupportedWriters: false,
      evidenceDigest: "a".repeat(64),
    });
    this.retained = { fence, sourceJson: this.sourceJson };
    this.writer = "fenced";
    await this.hooks.fence?.();
    return structuredClone(this.retained);
  }
  async verifyHostDecision(
    raw: Readonly<HostAuthorityDecision>,
    context: AuthorityRequestContext,
  ): Promise<object> {
    this.consume(context, "verify-decision");
    const decision = HostAuthorityDecisionSchema.parse(raw);
    if (
      !this.retained ||
      decision.sourceDigest !== this.retained.fence.sourceDigest ||
      decision.migrationId !== this.scope.migrationId ||
      hash(hostAuthorityDecisionDigestInput(decision)) !== decision.decisionDigest
    )
      throw new Error("fixture native decision mismatch");
    await this.hooks["verify-decision"]?.();
    const handle = Object.freeze({});
    this.handles.set(handle, decision);
    return handle;
  }
  async applyVerifiedDecision(handle: object, context: AuthorityRequestContext): Promise<void> {
    this.consume(context, "apply-decision");
    const decision = this.handles.get(handle);
    if (!decision) throw new Error("fixture native-owned decision handle missing");
    if (this.durable && this.durable.decisionDigest !== decision.decisionDigest)
      throw new Error("fixture opposite durable decision");
    this.durable = structuredClone(decision);
    this.writer = decision.phase === "host-active" ? "host" : "native";
    await this.hooks["apply-decision"]?.();
  }
  async readDecisionAcknowledgement(
    decision: Readonly<HostAuthorityDecision>,
    context: AuthorityRequestContext,
  ): Promise<HostAuthorityDecision> {
    this.consume(context, "read-native-ack");
    if (!this.durable || this.durable.decisionDigest !== decision.decisionDigest)
      throw new Error("fixture durable native decision missing");
    await this.hooks["read-native-ack"]?.();
    return structuredClone(this.durable);
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-authority-coordinator-"));
  cleanups.push(async () => {
    const target = resolve(root);
    if (
      resolve(join(target, "..")) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-authority-coordinator-")
    )
      throw new Error("refusing to remove unexpected test directory");
    await rm(target, { recursive: true, force: true });
  });
  const path = join(root, "host.db");
  let store = new HostStore(path);
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const scope = {
    environmentId: store.environmentId,
    sessionId: "native-session",
    migrationId: "migration",
  };
  const source: HostSession["session"] = {
    id: scope.sessionId,
    cwd: root,
    title: "Original ü/🙂",
    harness: "codex",
    model: "fixture",
    modelSettings: {},
    runtimeMode: "auto",
    providerSessionId: "provider-resume",
    providerAccountId: "account",
    workspaceMode: "current",
    blocks: [],
  };
  const native = new FixtureNative(scope, `${JSON.stringify(source, null, 2)}\n`);
  const converter: AuthoritySnapshotConverter = {
    version: "native-session/v1",
    convert: (raw) => ({
      projectId: project.id,
      revision: 1,
      updatedAt: 7,
      status: "idle",
      session: raw as unknown as HostSession["session"],
    }),
  };
  const install = vi.fn(async (stage: AuthorityStage) => {
    await store.save(stage.normalizedSnapshot, { type: "authority-migration-fixture" });
  });
  const verify = vi.fn(async (fence: NativeFenceEvidence, context: AuthorityRequestContext) => {
    native.consume(context);
    if (!native.retained || JSON.stringify(fence) !== JSON.stringify(native.retained.fence))
      throw new Error("fixture native retained fence does not match journal");
  });
  function createJournal() {
    return new HostAuthorityJournal({
      store,
      installTarget: install,
      verifyNativeActorAndChallenge: verify,
      verifyNativeDecisionAcknowledgement: async (_fence, decision) => {
        if (native.durable?.decisionDigest !== decision.decisionDigest)
          throw new Error("fixture authenticated native durable ack missing");
      },
    });
  }
  let journal = createJournal();
  await journal.ready;
  function coordinator(
    options: Partial<ConstructorParameters<typeof HostAuthorityCoordinator>[0]> = {},
  ) {
    return new HostAuthorityCoordinator({
      scope,
      expectedSourceGeneration: 0,
      native,
      journal,
      converter,
      ...options,
    });
  }
  async function reopen() {
    await store.close();
    store = new HostStore(path);
    await store.ready;
    journal = createJournal();
    await journal.ready;
  }
  return {
    root,
    path,
    scope,
    source,
    native,
    converter,
    install,
    verify,
    coordinator,
    reopen,
    get store() {
      return store;
    },
    get journal() {
      return journal;
    },
  };
}

it("orchestrates qualified fence, immutable exact-byte stage and native durable acknowledgement in order", async () => {
  const f = await fixture();
  const convert = vi.spyOn(f.converter, "convert");
  const result = await f.coordinator().migrate();
  expect(result.status).toMatchObject({ phase: "host-active", acknowledged: true });
  expect(result.decision.authorityGeneration).toBe(1);
  expect(f.native.writer).toBe("host");
  expect(f.native.events).toEqual([
    "read-snapshot",
    "fence",
    "prepare",
    "stage",
    "activate",
    "verify-decision",
    "apply-decision",
    "read-native-ack",
    "host-ack",
  ]);
  expect(new Set(f.native.contexts.keys()).size).toBe(f.native.events.length);
  expect(convert).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(convert.mock.calls[0][0])).toBe(true);
  expect(Object.isFrozen((convert.mock.calls[0][0] as { blocks: unknown }).blocks)).toBe(true);
  const row = await f.store.db
    .prepare("SELECT source_json, target_json FROM host_authority_journal")
    .get();
  expect(row?.source_json).toBe(f.native.sourceJson);
  expect(result.decision.sourceDigest).toBe(hash(f.native.sourceJson));
  expect(result.decision.sourceDigest).not.toBe(hash(JSON.stringify(f.source)));
  expect(hash(String(row?.target_json))).toBe(result.decision.targetDigest);
  expect((await f.store.session(f.scope.sessionId)).authorityGeneration).toBe(1);
  expect(f.install).toHaveBeenCalledTimes(1);
  await f.reopen();
  const before = f.native.events.length;
  expect((await f.coordinator().recover()).decision).toEqual(result.decision);
  expect(f.native.events).toHaveLength(before);
  expect(f.install).toHaveBeenCalledTimes(1);
});

it("recovers a crash immediately after durable native fencing from retained exact source bytes", async () => {
  const f = await fixture();
  f.native.hooks.fence = () => {
    throw new Error("crash after native fence");
  };
  await expect(f.coordinator().migrate()).rejects.toThrow("crash after native fence");
  expect(f.native.writer).toBe("fenced");
  expect(await f.journal.status(f.scope)).toBeUndefined();
  delete f.native.hooks.fence;
  await f.reopen();
  const result = await f.coordinator().recover();
  expect(result.status.acknowledged).toBe(true);
  expect(f.native.events.filter((step) => step === "fence")).toHaveLength(1);
  expect(result.decision.sourceDigest).toBe(hash(f.native.sourceJson));
});

it.each(["prepare", "stage", "activate"] as const)(
  "recovers crash after journal %s without reinstalling or guessing an abort",
  async (step) => {
    const f = await fixture();
    let disconnected = false;
    const overrides: Partial<JournalPort> = {
      status: async (scope) => {
        if (disconnected) throw new Error("Host decision unavailable after process loss");
        return f.journal.status(scope);
      },
    };
    if (step === "prepare")
      overrides.prepare = async (...args) => {
        await f.journal.prepare(...args);
        disconnected = true;
        throw new Error("process lost after prepare");
      };
    if (step === "stage")
      overrides.stage = async (...args) => {
        await f.journal.stage(...args);
        disconnected = true;
        throw new Error("process lost after stage");
      };
    if (step === "activate")
      overrides.activate = async (...args) => {
        await f.journal.activate(...args);
        disconnected = true;
        throw new Error("process lost after activate");
      };
    await expect(
      f.coordinator({ journal: journalPort(f.journal, overrides) }).migrate(),
    ).rejects.toThrow("Host decision unavailable");
    expect(f.native.writer).toBe("fenced");
    expect(f.native.events).not.toContain("abort");
    expect((await f.journal.status(f.scope))?.phase).toBe(
      step === "activate" ? "host-active" : step === "stage" ? "staged" : "prepared",
    );
    await f.reopen();
    const before = f.native.events.length;
    const result = await f.coordinator().recover();
    expect(result.status.acknowledged).toBe(true);
    expect(f.install).toHaveBeenCalledTimes(1);
    if (step === "activate") {
      expect(f.native.events.slice(before)).toEqual([
        "verify-decision",
        "apply-decision",
        "read-native-ack",
        "host-ack",
      ]);
    }
  },
);

it.each(["apply-decision", "read-native-ack"] as const)(
  "keeps a crash after %s recoverable without silently retrying unfinished native steps",
  async (step) => {
    const f = await fixture();
    f.native.hooks[step] = () => {
      throw new Error(`crash after ${step}`);
    };
    await expect(f.coordinator().migrate()).rejects.toThrow(`crash after ${step}`);
    expect(f.native.events.filter((value) => value === step)).toHaveLength(1);
    expect(f.native.writer).toBe("host");
    expect((await f.journal.status(f.scope))?.acknowledged).toBe(false);
    delete f.native.hooks[step];
    await f.reopen();
    const result = await f.coordinator().recover();
    expect(result.status.acknowledged).toBe(true);
    expect(result.decision).toEqual(f.native.durable);
    expect(f.install).toHaveBeenCalledTimes(1);
  },
);

it("uses permanent Host acknowledgement after its reply is lost without repeating native apply", async () => {
  const f = await fixture();
  const port = journalPort(f.journal, {
    ack: async (...args) => {
      await f.journal.ack(...args);
      throw new Error("Host ack reply lost");
    },
  });
  await expect(f.coordinator({ journal: port }).migrate()).rejects.toThrow("Host ack reply lost");
  expect((await f.journal.status(f.scope))?.acknowledged).toBe(true);
  const before = f.native.events.length;
  await f.reopen();
  expect((await f.coordinator().recover()).status.acknowledged).toBe(true);
  expect(f.native.events).toHaveLength(before);
});

it("reconciles one uncertain Host activation against its permanent decision without replaying activation", async () => {
  const f = await fixture();
  const activate = vi.fn(async (...args: Parameters<HostAuthorityJournal["activate"]>) => {
    await f.journal.activate(...args);
    throw new Error("activation reply lost");
  });
  const result = await f.coordinator({ journal: journalPort(f.journal, { activate }) }).migrate();
  expect(result.status.acknowledged).toBe(true);
  expect(activate).toHaveBeenCalledTimes(1);
  expect(f.install).toHaveBeenCalledTimes(1);
  expect(f.native.events).not.toContain("abort");
});

it("cancels before fencing only through an explicit native authoritative receipt", async () => {
  const f = await fixture();
  const receipt = await f.coordinator().cancelBeforeFence();
  expect(receipt).toMatchObject({ sourceGeneration: 0, authorityGeneration: 1 });
  expect(f.native.events).toEqual(["cancel-quiesce"]);
  expect(await f.journal.status(f.scope)).toBeUndefined();
  await expect(f.coordinator().abort()).rejects.toThrow("retained durable source snapshot");
  expect(f.native.events).not.toContain("fence");
});

it("never turns a raced native fence into local cancellation or automatic abort", async () => {
  const f = await fixture();
  f.native.hooks["cancel-quiesce"] = async () => {
    await f.native.quiesceAndFence(0, await f.native.authenticatedContext(f.scope, "fence"));
  };
  await expect(f.coordinator().cancelBeforeFence()).rejects.toThrow("source is fenced");
  expect(await f.journal.status(f.scope)).toBeUndefined();
  expect(f.native.writer).toBe("fenced");
  expect((await f.coordinator().abort()).decision.phase).toBe("aborted");
});

it.each(["scope", "identity", "overflow", "generation", "unknown"])(
  "rejects %s native cancellation receipts without retry",
  async (fault) => {
    const f = await fixture();
    const original = f.native.cancelQuiesce.bind(f.native);
    const cancel = vi.spyOn(f.native, "cancelQuiesce").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (result.kind !== "cancelled") throw new Error("fixture");
      if (fault === "scope") result.receipt.sessionId = "other";
      if (fault === "identity") result.receipt.identity.sourceStoreId = "other";
      if (fault === "overflow") result.receipt.authorityGeneration = Number.MAX_SAFE_INTEGER + 1;
      if (fault === "generation") result.receipt.sourceGeneration = 2;
      if (fault === "unknown") return { kind: "unknown" } as never;
      return result;
    });
    await expect(f.coordinator().cancelBeforeFence()).rejects.toThrow();
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await f.journal.status(f.scope)).toBeUndefined();
  },
);

it("holds cancellation admission until native settlement and refuses retained Host migrations", async () => {
  const f = await fixture();
  const entered = deferred<void>(),
    release = deferred<void>();
  f.native.hooks["cancel-quiesce"] = async () => {
    entered.resolve();
    await release.promise;
  };
  const operation = f.coordinator().cancelBeforeFence();
  await entered.promise;
  await expect(f.coordinator().migrate()).rejects.toBeInstanceOf(AuthorityCoordinatorBusyError);
  release.resolve();
  await operation;
  const g = await fixture();
  await g.coordinator().migrate();
  const cancel = vi.spyOn(g.native, "cancelQuiesce");
  await expect(g.coordinator().cancelBeforeFence()).rejects.toThrow("retained Host migration");
  expect(cancel).not.toHaveBeenCalled();
});

it("explicit abort commits Host CAS before applying a higher native writer generation", async () => {
  const f = await fixture();
  await f.native.quiesceAndFence(0, await f.native.authenticatedContext(f.scope, "fence"));
  f.native.hooks["apply-decision"] = async () => {
    expect((await f.journal.status(f.scope))?.phase).toBe("aborted");
    expect(f.native.durable?.authorityGeneration).toBe(2);
  };
  const result = await f.coordinator().abort();
  expect(result.decision).toMatchObject({
    phase: "aborted",
    sourceGeneration: 1,
    authorityGeneration: 2,
  });
  expect(result.status.acknowledged).toBe(true);
  expect(f.native.writer).toBe("native");
  expect(f.install).not.toHaveBeenCalled();
  await expect(f.store.session(f.scope.sessionId)).rejects.toThrow();
});

it.each(["migrate", "abort"] as const)(
  "a permanent opposite decision dominates the later %s intent",
  async (intent) => {
    const f = await fixture();
    await f.native.quiesceAndFence(0, await f.native.authenticatedContext(f.scope, "fence"));
    const first =
      intent === "abort" ? await f.coordinator().migrate() : await f.coordinator().abort();
    const before = f.native.events.length;
    expect((await f.coordinator()[intent]()).decision).toEqual(first.decision);
    expect(f.native.events).toHaveLength(before);
  },
);

it("arbitrates activation versus explicit abort across independent process budgets with one permanent decision", async () => {
  const f = await fixture();
  f.native.retained = await f.native.quiesceAndFence(
    0,
    await f.native.authenticatedContext(f.scope, "fence"),
  );
  const entered = deferred<void>();
  const release = deferred<void>();
  const staged = journalPort(f.journal, {
    activate: async (...args) => {
      entered.resolve();
      await release.promise;
      return f.journal.activate(...args);
    },
  });
  const migrating = f
    .coordinator({ journal: staged, admission: new AuthorityCoordinatorAdmission(1) })
    .migrate();
  void migrating.catch(entered.reject);
  await entered.promise;
  const aborting = f.coordinator({ admission: new AuthorityCoordinatorAdmission(1) }).abort();
  const aborted = await aborting;
  release.resolve();
  const migrated = await migrating;
  expect(aborted.decision.phase).toBe("aborted");
  expect(migrated.decision).toEqual(aborted.decision);
  expect(f.native.writer).toBe("native");
  expect(f.install).not.toHaveBeenCalled();
});

it("does no native work when the permanent Host status is unavailable", async () => {
  const f = await fixture();
  const status = vi.fn(async () => {
    throw new Error("Host unavailable");
  });
  await expect(
    f.coordinator({ journal: journalPort(f.journal, { status }) }).recover(),
  ).rejects.toThrow("Host unavailable");
  expect(f.native.events).toEqual([]);
  expect(f.native.writer).toBe("native");
});

it("requires retained recovery bytes and never guesses a fence or native unfreeze from missing Host status", async () => {
  const f = await fixture();
  await expect(f.coordinator().recover()).rejects.toThrow("retained durable source snapshot");
  expect(f.native.events).toEqual(["read-snapshot"]);
  expect(f.native.writer).toBe("native");
  expect(await f.journal.status(f.scope)).toBeUndefined();
});

it("missing qualified writer/window proof leaves both Host target and provider work absent", async () => {
  const f = await fixture();
  f.native.qualified = false;
  await expect(f.coordinator().migrate()).rejects.toThrow("writer inventory proof missing");
  expect(await f.journal.status(f.scope)).toBeUndefined();
  expect(f.install).not.toHaveBeenCalled();
  expect(f.native.writer).toBe("native");
  expect(() => f.coordinator({ native: {} as AuthenticatedNativeAuthorityPort })).toThrow(
    "Authenticated native authority",
  );
});

it.each(["source-bytes", "scope", "generation", "profile"] as const)(
  "rejects mismatched native %s without activating or unfreezing",
  async (mismatch) => {
    const f = await fixture();
    await f.native.quiesceAndFence(0, await f.native.authenticatedContext(f.scope, "fence"));
    if (mismatch === "source-bytes") f.native.retained!.sourceJson += " ";
    if (mismatch === "scope") f.native.retained!.fence.sessionId = "wrong-session";
    if (mismatch === "generation") f.native.retained!.fence.generation = 2;
    if (mismatch === "profile") f.native.retained!.fence.sourceProfileId = "wrong-profile";
    await expect(f.coordinator().recover()).rejects.toThrow();
    expect(f.native.writer).toBe("fenced");
    expect(f.install).not.toHaveBeenCalled();
    expect(await f.journal.status(f.scope)).toBeUndefined();
  },
);

it("requires a fresh authenticated context and keeps independent journal verification mandatory", async () => {
  const f = await fixture();
  const context = await f.native.authenticatedContext(f.scope, "read-snapshot");
  vi.spyOn(f.native, "authenticatedContext").mockResolvedValue(context);
  await expect(f.coordinator().migrate()).rejects.toThrow("fresh authenticated challenge");
  expect(f.native.events).toEqual(["read-snapshot"]);
  expect(f.install).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  f.verify.mockRejectedValue(new Error("real verifier refuses fixture actor"));
  await expect(f.coordinator().migrate()).rejects.toThrow("real verifier refuses fixture actor");
  expect(f.native.writer).toBe("fenced");
  expect(await f.journal.status(f.scope)).toBeUndefined();
});

it.each([null, true, [], {}])(
  "malformed native verification handle %j never acknowledges a Host decision",
  async (handle) => {
    const f = await fixture();
    vi.spyOn(f.native, "verifyHostDecision").mockResolvedValue(handle as object);
    await expect(f.coordinator().migrate()).rejects.toThrow();
    expect((await f.journal.status(f.scope))?.acknowledged).toBe(false);
    expect(f.native.writer).toBe("fenced");
    expect(f.native.events).not.toContain("host-ack");
  },
);

it("rejects a different but validly hashed native receipt rather than acknowledging a fabricated apply", async () => {
  const f = await fixture();
  vi.spyOn(f.native, "readDecisionAcknowledgement").mockImplementation(
    async (decision, context) => {
      f.native.consume(context, "read-native-ack");
      const other = { ...decision, receiptId: "wrong-native-receipt" };
      return { ...other, decisionDigest: hash(hostAuthorityDecisionDigestInput(other)) };
    },
  );
  await expect(f.coordinator().migrate()).rejects.toThrow(
    "differs from the permanent Host decision",
  );
  expect((await f.journal.status(f.scope))?.acknowledged).toBe(false);
  expect(f.native.events).not.toContain("host-ack");
});

it("requires the original converter on staged recovery and preserves immutable source/target bytes", async () => {
  const f = await fixture();
  let crashed = false;
  const port = journalPort(f.journal, {
    status: (scope) => (crashed ? Promise.reject(new Error("crash")) : f.journal.status(scope)),
    stage: async (...args) => {
      await f.journal.stage(...args);
      crashed = true;
      throw new Error("crash");
    },
  });
  await expect(f.coordinator({ journal: port }).migrate()).rejects.toThrow("crash");
  await f.reopen();
  await expect(
    f.coordinator({ converter: { ...f.converter, version: "native-session/v2" } }).recover(),
  ).rejects.toThrow("original immutable converter");
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  expect(f.native.writer).toBe("fenced");
  expect(f.install).not.toHaveBeenCalled();
  expect((await f.coordinator().recover()).status.acknowledged).toBe(true);
});

it("does not allow source mutation or a converter-supplied authority generation", async () => {
  const f = await fixture();
  const mutate: AuthoritySnapshotConverter = {
    version: "native-session/v1",
    convert: (raw) => {
      (raw as Record<string, unknown>).title = "changed";
      return f.converter.convert(raw, f.native.retained!.fence);
    },
  };
  await expect(f.coordinator({ converter: mutate }).migrate()).rejects.toThrow();
  expect(f.native.writer).toBe("fenced");
  expect(f.native.retained!.sourceJson).toBe(f.native.sourceJson);
  const wrong: AuthoritySnapshotConverter = {
    version: "native-session/v1",
    convert: (raw, fence) => ({ ...f.converter.convert(raw, fence), authorityGeneration: 99 }),
  };
  await expect(f.coordinator({ converter: wrong }).recover()).rejects.toThrow(
    "authority generation changed",
  );
  expect(f.install).not.toHaveBeenCalled();
});

it.each([
  "9007199254740993",
  "9007199254740990.5",
  "1e-400",
  "1e309",
  "0.123456789012345678901",
  "-0",
])(
  "rejects unsafe source number %s before conversion rather than truncating it",
  async (number) => {
    const f = await fixture();
    f.native.sourceJson = f.native.sourceJson.replace(
      '"modelSettings": {}',
      `"modelSettings": {"unsafe": ${number}}`,
    );
    const convert = vi.spyOn(f.converter, "convert");
    await expect(f.coordinator().migrate()).rejects.toThrow("without loss");
    expect(convert).not.toHaveBeenCalled();
    expect(f.native.writer).toBe("fenced");
    expect(f.install).not.toHaveBeenCalled();
  },
);

it("rejects oversize retained source before JSON parsing or conversion", async () => {
  const f = await fixture();
  f.native.sourceJson = `{"id":"native-session","oversize":"${"x".repeat(32 * 1024 * 1024)}"}`;
  const convert = vi.spyOn(f.converter, "convert");
  await expect(f.coordinator().migrate()).rejects.toThrow("durable fence");
  expect(convert).not.toHaveBeenCalled();
  expect(f.install).not.toHaveBeenCalled();
  expect(f.native.writer).toBe("fenced");
});

it("preserves supported decimal and safe integer source values", async () => {
  const f = await fixture();
  f.native.sourceJson = f.native.sourceJson.replace(
    '"modelSettings": {}',
    '"modelSettings": {"temperature": 0.1, "small": 1e-7, "counter": 9007199254740991}',
  );
  expect((await f.coordinator().migrate()).status.acknowledged).toBe(true);
  expect((await f.store.session(f.scope.sessionId)).session.modelSettings).toEqual({
    temperature: 0.1,
    small: 1e-7,
    counter: Number.MAX_SAFE_INTEGER,
  });
});

it.each(["getter", "symbol", "sparse-array", "negative-zero"] as const)(
  "rejects converter %s output that JSON would silently change or omit",
  async (defect) => {
    const f = await fixture();
    const converter: AuthoritySnapshotConverter = {
      version: "native-session/v1",
      convert: (source, fence) => {
        const result = f.converter.convert(source, fence);
        if (defect === "getter")
          Object.defineProperty(result, "revision", { enumerable: true, get: () => 1 });
        if (defect === "symbol") Object.assign(result, { [Symbol("lost")]: true });
        if (defect === "sparse-array") Object.assign(result, { omitted: Array(1) });
        if (defect === "negative-zero") Object.assign(result, { omitted: -0 });
        return result;
      },
    };
    await expect(f.coordinator({ converter }).migrate()).rejects.toThrow();
    expect(f.native.writer).toBe("fenced");
    expect(f.install).not.toHaveBeenCalled();
    expect((await f.journal.status(f.scope))?.phase).toBe("prepared");
  },
);

it("shares default session admission across coordinator objects and retains slots until actual native work settles", async () => {
  const f = await fixture();
  const entered = deferred<void>();
  const release = deferred<void>();
  f.native.hooks["read-snapshot"] = async () => {
    entered.resolve();
    await release.promise;
  };
  const pending = f.coordinator().migrate();
  await entered.promise;
  await expect(f.coordinator().abort()).rejects.toBeInstanceOf(AuthorityCoordinatorBusyError);
  await expect(
    f.coordinator({ scope: { ...f.scope, migrationId: "different-migration" } }).recover(),
  ).rejects.toBeInstanceOf(AuthorityCoordinatorBusyError);
  await Promise.resolve();
  await expect(f.coordinator().recover()).rejects.toBeInstanceOf(AuthorityCoordinatorBusyError);
  release.resolve();
  expect((await pending).status.acknowledged).toBe(true);
  expect((await f.coordinator().recover()).status.acknowledged).toBe(true);
});

it("bounds total actual backend work and releases admission only after rejection settles", async () => {
  const admission = new AuthorityCoordinatorAdmission(1);
  const release = deferred<void>();
  const one = { environmentId: "environment", sessionId: "one", migrationId: "migration" };
  const two = { ...one, sessionId: "two" };
  const pending = admission.run(one, () => release.promise);
  expect(admission.size).toBe(1);
  const work = vi.fn(async () => undefined);
  await expect(admission.run(two, work)).rejects.toBeInstanceOf(AuthorityCoordinatorBusyError);
  expect(work).not.toHaveBeenCalled();
  const rejection = expect(pending).rejects.toThrow("backend stopped");
  release.reject(new Error("backend stopped"));
  await rejection;
  expect(admission.size).toBe(0);
  await admission.run(two, work);
  expect(work).toHaveBeenCalledTimes(1);
});

it("shares the default global work budget across independent coordinator objects", async () => {
  const release = deferred<void>();
  const pending: Array<Promise<unknown>> = [];
  for (let index = 0; index < 4; index++) {
    const f = await fixture();
    const entered = deferred<void>();
    f.native.hooks["read-snapshot"] = async () => {
      entered.resolve();
      await release.promise;
    };
    pending.push(
      f
        .coordinator()
        .recover()
        .catch((error) => error),
    );
    await entered.promise;
  }
  try {
    const fifth = await fixture();
    await expect(fifth.coordinator().recover()).rejects.toBeInstanceOf(
      AuthorityCoordinatorBusyError,
    );
    expect(fifth.native.events).toEqual([]);
  } finally {
    release.resolve();
    const results = await Promise.all(pending);
    for (const result of results) expect(result).toBeInstanceOf(Error);
  }
});
