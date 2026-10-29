import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NativeAuthorityHelperRuntime } from "./helper-client";
import { NativeSourceRegistry } from "./source-registry";
import { sourceFixture } from "./fixtures/source-helper.mjs";
import { retainedFixture } from "./fixtures/retained-helper.mjs";
import { RETAINED_SOURCE_MAX_BYTES } from "./retained-source";

const fixtures: Awaited<ReturnType<typeof sourceFixture>>[] = [];
const retainedFixtures: Awaited<ReturnType<typeof retainedFixture>>[] = [];
async function retained(options: Parameters<typeof retainedFixture>[0] = {}) {
  const value = await retainedFixture({
    Runtime: NativeAuthorityHelperRuntime,
    Registry: NativeSourceRegistry,
    ...options,
  });
  retainedFixtures.push(value);
  return value;
}
async function fixture(options: Parameters<typeof sourceFixture>[0] = {}) {
  const value = await sourceFixture({
    Runtime: NativeAuthorityHelperRuntime,
    Registry: NativeSourceRegistry,
    ...options,
  });
  fixtures.push(value);
  return value;
}
afterEach(async () => {
  for (const value of fixtures.splice(0)) await value.cleanup();
  for (const value of retainedFixtures.splice(0)) await value.cleanup();
});

describe("actual child-backed retained export ownership", () => {
  const scope = { sessionId: "session", migrationId: "migration" };
  it("returns exact multichunk Unicode and keeps heartbeat/status outside the whole export", async () => {
    const sourceJson = JSON.stringify({
      x: "a".repeat(16377) + "🍏 İstanbul\n" + "Ω".repeat(18000),
    });
    const f = await retained({
      config: { sourceJson, chunkDelay: 10 },
      registryOptions: { heartbeatMs: 10 },
    });
    const association = await f.registry.register(f.input);
    const result = await f.registry.readRetainedSnapshot(reference(association), scope);
    expect(result).toMatchObject({
      state: "retained",
      sourceJson,
      qualified: false,
      fence: {
        ...scope,
        sourceStoreId: association.sourceStoreId,
        sourceProfileId: association.sourceProfileId,
      },
    });
    expect(Object.isFrozen(result)).toBe(true);
    await vi.waitFor(async () =>
      expect((await f.audit()).some((entry) => entry.kind === "source-status")).toBe(true),
    );
    const audit = await f.audit();
    const opening = audit.findIndex((entry) => entry.kind === "source-retained-open");
    const closing = audit.findIndex((entry) => entry.kind === "source-retained-close");
    expect(
      audit.slice(opening + 1, closing).every((entry) => entry.kind === "source-retained-chunk"),
    ).toBe(true);
    expect(audit.filter((entry) => entry.requestId).map((entry) => entry.requestId)).toEqual(
      audit.filter((entry) => entry.requestId).map((_, index) => index + 1),
    );
    expect(await f.registry.status(reference(association))).toEqual(association);
    expect(f.registry.observation()).toMatchObject({
      activeRetainedTransfers: 0,
      reservedSourceBytes: 0,
    });
  });
  it("returns absent without closing a healthy source and rejects caller scope extras before I/O", async () => {
    const f = await retained({ config: { absent: true } });
    const association = await f.registry.register(f.input);
    await expect(
      f.registry.readRetainedSnapshot(reference(association), {
        ...scope,
        sourceStoreId: "forged",
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(await f.registry.readRetainedSnapshot(reference(association), scope)).toEqual({
      state: "absent",
      qualified: false,
    });
    expect(await f.registry.status(reference(association))).toEqual(association);
    expect(
      (await f.audit()).filter((entry) => entry.kind.startsWith("source-retained")),
    ).toHaveLength(1);
  });
  it("charges queued accepted transfers globally across registries before any third native open", async () => {
    const f = await retained({ config: { openDelay: 120 } });
    const g = await retained();
    const association = await f.registry.register(f.input);
    const other = await g.registry.register(g.input);
    const first = f.registry.readRetainedSnapshot(reference(association), scope);
    const second = f.registry.readRetainedSnapshot(reference(association), scope);
    expect(g.registry.observation()).toMatchObject({
      activeRetainedTransfers: 2,
      reservedSourceBytes: 2 * RETAINED_SOURCE_MAX_BYTES,
    });
    await expect(g.registry.readRetainedSnapshot(reference(other), scope)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    expect((await g.audit()).some((entry) => entry.kind === "source-retained-open")).toBe(false);
    expect(await g.registry.status(reference(other))).toEqual(other);
    await Promise.all([first, second]);
    expect((await g.registry.readRetainedSnapshot(reference(other), scope)).state).toBe("retained");
    expect(f.registry.observation().activeRetainedTransfers).toBe(0);
  });
  it("retains failed export budget until actual delayed child exit without replay", async () => {
    const f = await retained({ config: { badDigest: true, exitDelay: 180 } });
    const association = await f.registry.register(f.input);
    const outcome = f.registry
      .readRetainedSnapshot(reference(association), scope)
      .catch((error) => error);
    await vi.waitFor(async () =>
      expect((await f.audit()).some((entry) => entry.kind === "helper-close")).toBe(true),
    );
    expect(f.registry.observation()).toMatchObject({
      activeRetainedTransfers: 1,
      reservedSourceBytes: RETAINED_SOURCE_MAX_BYTES,
      activeHelpers: 1,
    });
    expect(await outcome).toMatchObject({ code: "SCOPE_CHANGED" });
    expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
    expect(f.registry.observation()).toMatchObject({
      activeRetainedTransfers: 0,
      reservedSourceBytes: 0,
    });
    expect(f.opens).toBe(1);
    expect((await f.audit()).filter((entry) => entry.kind === "source-retained-open")).toHaveLength(
      1,
    );
  });
  it("drains an accepted export before unregister while rejecting later source work", async () => {
    const f = await retained({ config: { chunkDelay: 80, exitDelay: 100 } });
    const association = await f.registry.register(f.input);
    const reading = f.registry.readRetainedSnapshot(reference(association), scope);
    const retiring = f.registry.unregister(reference(association));
    await expect(
      f.registry.readRetainedSnapshot(reference(association), scope),
    ).rejects.toMatchObject({ code: "SOURCE_CLOSED" });
    expect((await reading).state).toBe("retained");
    expect(f.registry.observation().activeHelpers).toBe(1);
    await retiring;
    expect(f.registry.observation()).toMatchObject({
      activeHelpers: 0,
      activeRetainedTransfers: 0,
    });
  });
  it("settles both running and queued transfer leases during shutdown without opening the queued export", async () => {
    const f = await retained({ config: { openDelay: 500 } });
    const association = await f.registry.register(f.input);
    const outcomes = Promise.allSettled([
      f.registry.readRetainedSnapshot(reference(association), scope),
      f.registry.readRetainedSnapshot(reference(association), scope),
    ]);
    await vi.waitFor(async () =>
      expect((await f.audit()).some((entry) => entry.kind === "source-retained-open")).toBe(true),
    );
    await f.registry.close();
    expect((await outcomes).every((entry) => entry.status === "rejected")).toBe(true);
    expect(f.registry.observation()).toMatchObject({
      activeHelpers: 0,
      activeRetainedTransfers: 0,
      acceptedOperations: 0,
      sources: 0,
    });
    expect((await f.audit()).filter((entry) => entry.kind === "source-retained-open")).toHaveLength(
      1,
    );
  });
  it("closes a disconnected retained export, waits actual exit, and does not reconnect", async () => {
    const f = await retained({ config: { disconnectChunk: true } });
    const association = await f.registry.register(f.input);
    await expect(
      f.registry.readRetainedSnapshot(reference(association), scope),
    ).rejects.toMatchObject({ code: "TRANSPORT_UNKNOWN" });
    expect(f.children[0].exitCode).toBe(0);
    expect(f.registry.observation()).toMatchObject({
      activeHelpers: 0,
      activeRetainedTransfers: 0,
    });
    expect(f.opens).toBe(1);
  });
  it("uses one nonrenewing deadline for the entire export rather than a fresh budget per chunk", async () => {
    const f = await retained({
      config: { sourceJson: JSON.stringify({ text: "a".repeat(40000) }), chunkDelay: 100 },
      registryOptions: { operationTimeoutMs: 250 },
    });
    const association = await f.registry.register(f.input);
    await expect(
      f.registry.readRetainedSnapshot(reference(association), scope),
    ).rejects.toMatchObject({ code: "DEADLINE" });
    expect(f.registry.observation()).toMatchObject({
      activeHelpers: 0,
      activeRetainedTransfers: 0,
    });
    const audit = await f.audit();
    expect(audit.filter((entry) => entry.kind === "source-retained-open")).toHaveLength(1);
    expect(audit.filter((entry) => entry.kind === "source-retained-close")).toHaveLength(0);
    expect(f.opens).toBe(1);
  });
});
const reference = (association: { associationId: string; sourceEpoch: string }) => ({
  associationId: association.associationId,
  sourceEpoch: association.sourceEpoch,
});

describe("private source projection observation", () => {
  const scope = { sessionId: "logical.session", migrationId: "migration.round", generation: 7 };
  it("uses the original associated source, serializes status, and freezes the exact unqualified result", async () => {
    const prepareId = randomUUID();
    const f = await fixture({
      config: { prepareId, projectionDelay: 40 },
      registryOptions: { heartbeatMs: 10 },
    });
    const association = await f.registry.register(f.first.input);
    const observed = f.registry.observeProjection(reference(association), scope);
    const status = f.registry.status(reference(association));
    expect(await observed).toEqual({
      version: 1,
      qualified: false,
      prepareId,
      status: "unverified",
      receiptCount: 0,
      missingCoverage: ["fixture-not-native-proof"],
    });
    expect(await status).toEqual(association);
    const result = await f.registry.observeProjection(reference(association), scope);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.missingCoverage)).toBe(true);
    const audit = await f.audit();
    const calls = audit.filter((entry) => entry.kind === "source-projection-observe");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      version: 1,
      kind: "source-projection-observe",
      requestId: 1,
      sourceEpoch: association.sourceEpoch,
      ...scope,
    });
    expect(audit.findIndex((entry) => entry.kind === "source-status")).toBeGreaterThan(
      audit.findIndex((entry) => entry.kind === "source-projection-observe"),
    );
    expect(f.opens).toBe(1);
  });
  it("rejects stale refs, caller authority and oversized generation before sending", async () => {
    const f = await fixture();
    const association = await f.registry.register(f.first.input);
    await expect(
      f.registry.observeProjection({ ...reference(association), sourceEpoch: randomUUID() }, scope),
    ).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    for (const invalid of [
      { ...scope, generation: Number.MAX_SAFE_INTEGER + 1 },
      { ...scope, qualified: true },
      { ...scope, sessionId: "route#not-a-target" },
    ])
      await expect(
        f.registry.observeProjection(reference(association), invalid),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await f.audit()).some((entry) => entry.kind === "source-projection-observe")).toBe(
      false,
    );
    expect(await f.registry.status(reference(association))).toEqual(association);
  });
  it("keeps the accepted queue charged while the actual child operation is pending", async () => {
    const f = await fixture({
      config: { projectionDelay: 100 },
      registryOptions: { maxQueuedStatus: 1 },
    });
    const association = await f.registry.register(f.first.input);
    const pending = f.registry.observeProjection(reference(association), scope);
    await expect(f.registry.observeProjection(reference(association), scope)).rejects.toMatchObject(
      { code: "CAPACITY" },
    );
    await expect(f.registry.status(reference(association))).rejects.toMatchObject({
      code: "CAPACITY",
    });
    const retiring = f.registry.unregister(reference(association));
    await expect(f.registry.observeProjection(reference(association), scope)).rejects.toMatchObject(
      { code: "SOURCE_CLOSED" },
    );
    expect((await pending).qualified).toBe(false);
    await retiring;
    expect(f.registry.observation().sources).toBe(0);
    expect(
      (await f.audit()).filter((entry) => entry.kind === "source-projection-observe"),
    ).toHaveLength(1);
  });
  it.each([
    { projectionError: "DEADLINE" },
    { disconnectProjection: true },
    { projectionChange: { sourceEpoch: randomUUID() } },
    { projectionObservation: { qualified: true } },
    { projectionObservation: { receiptCount: 65 } },
    { projectionObservation: { missingCoverage: ["🦀".repeat(129)] } },
    { projectionObservation: { fullCheckpoint: true } },
  ])("closes on uncertain/mismatched replies without resend: %j", async (config) => {
    const f = await fixture({ config });
    const association = await f.registry.register(f.first.input);
    await expect(f.registry.observeProjection(reference(association), scope)).rejects.toBeDefined();
    expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
    await expect(f.registry.observeProjection(reference(association), scope)).rejects.toMatchObject(
      { code: "SOURCE_CLOSED" },
    );
    expect(f.opens).toBe(1);
    expect(
      (await f.audit()).filter((entry) => entry.kind === "source-projection-observe"),
    ).toHaveLength(1);
  });
});
const lookup = (input: {
  deploymentId: string;
  registrationNonce: string;
  expectedHostEnvironmentId: string;
}) => ({
  deploymentId: input.deploymentId,
  registrationNonce: input.registrationNonce,
  expectedHostEnvironmentId: input.expectedHostEnvironmentId,
});

describe("actual child-backed native source locator registry", () => {
  it("captures received scope/protocol immutably and performs a real status read with exact IDs", async () => {
    const f = await fixture();
    const association = await f.registry.register(f.first.input);
    expect(association).toEqual({
      version: 1,
      associationId: expect.any(String),
      environmentId: "host-source-test",
      sourceStoreId: f.first.config.sourceStoreId,
      sourceProfileId: f.first.config.sourceProfileId,
      sourceEpoch: f.first.config.sourceEpoch,
      writerProtocol: 2,
      qualified: false,
    });
    expect(Object.isFrozen(association)).toBe(true);
    expect(await f.registry.status(reference(association))).toEqual(association);
    expect((await f.audit()).filter((entry) => entry.kind === "source-status")).toEqual([
      { version: 1, kind: "source-status", requestId: 1, sourceEpoch: association.sourceEpoch },
    ]);
    const retirement = await f.registry.unregister(reference(association));
    expect(retirement).toEqual({
      version: 1,
      ...reference(association),
      retired: true,
      qualified: false,
    });
    expect(f.registry.observation()).toMatchObject({
      sources: 0,
      activeHelpers: 0,
      qualified: false,
    });
  });

  it("publishes intent before provider await and joins exact duplicates without another helper/hello", async () => {
    const f = await fixture();
    const release = f.hold();
    const original = f.registry.register(f.first.input);
    expect(f.registry.lookup(lookup(f.first.input))).toEqual({
      version: 1,
      state: "pending",
      qualified: false,
    });
    const duplicate = f.registry.register({ ...f.first.input });
    expect(duplicate).toBe(original);
    expect(f.opens).toBe(1);
    release();
    const association = await original;
    expect(await duplicate).toBe(association);
    expect(f.registry.lookup(lookup(f.first.input))).toEqual({
      version: 1,
      state: "associated",
      association,
      qualified: false,
    });
    expect(await f.registry.register(f.first.input)).toBe(association);
    expect(f.children).toHaveLength(1);
    expect((await f.audit()).filter((entry) => entry.kind === "source-hello")).toHaveLength(1);
  });

  it("rejects a nonce tuple replacement while preserving the original actual pending owner", async () => {
    const f = await fixture();
    const release = f.hold();
    const original = f.registry.register(f.first.input);
    await expect(
      f.registry.register({
        ...f.first.input,
        address:
          f.first.input.address.slice(0, -1) + (f.first.input.address.endsWith("b") ? "c" : "b"),
      }),
    ).rejects.toMatchObject({ code: "REPLAY" });
    expect(f.opens).toBe(1);
    release();
    const association = await original;
    expect(await f.registry.status(reference(association))).toEqual(association);
  });

  it("keeps lookup memory-only and scoped, without status I/O or heartbeat renewal", async () => {
    const f = await fixture();
    const association = await f.registry.register(f.first.input);
    const before = (await f.audit()).length;
    for (let index = 0; index < 4; index++)
      expect(f.registry.lookup(lookup(f.first.input)).state).toBe("associated");
    expect(await f.audit()).toHaveLength(before);
    expect(() =>
      f.registry.lookup({ ...lookup(f.first.input), deploymentId: randomUUID() }),
    ).toThrow("SCOPE_CHANGED");
    expect(
      f.registry.lookup({ ...lookup(f.first.input), registrationNonce: randomUUID() }),
    ).toEqual({ version: 1, state: "absent", qualified: false });
    await f.registry.unregister(reference(association));
    expect(f.registry.lookup(lookup(f.first.input))).toEqual({
      version: 1,
      state: "failed",
      qualified: false,
    });
  });

  it.each([
    { registrationNonce: randomUUID() },
    { environmentId: "wrong-host" },
    { sourceEpoch: "not-a-native-epoch" },
    { qualified: true },
    { writerProtocol: 0 },
    { sourceProfileId: randomUUID() },
    { callerPID: 1 },
  ])(
    "rejects a forged/changed actual HELLO without publishing an association: %j",
    async (helloChange) => {
      const f = await fixture({ config: { helloChange } });
      await expect(f.registry.register(f.first.input)).rejects.toMatchObject({
        code: "SCOPE_CHANGED",
      });
      expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
      expect(f.registry.observation()).toMatchObject({ sources: 0, activeHelpers: 0 });
    },
  );

  it("binds actual profile to the trusted provider, not a caller profile or deployment locator", async () => {
    const f = await fixture({ config: { expectedProfile: randomUUID() } });
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({
      code: "SCOPE_CHANGED",
    });
    expect(f.children).toHaveLength(1);
    const invalid = {
      ...f.first.input,
      registrationNonce: randomUUID(),
      sourceProfileId: f.first.config.sourceProfileId,
    };
    await expect(f.registry.register(invalid)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.children).toHaveLength(1);
  });

  it("does not replace a live source when a second endpoint replays its source epoch", async () => {
    const f = await fixture();
    const original = await f.registry.register(f.first.input);
    const duplicate = await f.endpoint({ sourceEpoch: original.sourceEpoch });
    await expect(f.registry.register(duplicate.input)).rejects.toMatchObject({ code: "REPLAY" });
    expect(await f.registry.status(reference(original))).toEqual(original);
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("associated");
  });

  it.each([
    { sourceStoreId: randomUUID() },
    { sourceProfileId: randomUUID() },
    { sourceEpoch: randomUUID() },
    { requestId: 2 },
    { qualified: true },
  ])(
    "closes on a mismatched real status and never opens a replacement helper: %j",
    async (statusChange) => {
      const f = await fixture({ config: { statusChange } });
      const association = await f.registry.register(f.first.input);
      await expect(f.registry.status(reference(association))).rejects.toMatchObject({
        code: "SCOPE_CHANGED",
      });
      await vi.waitFor(() => expect(f.registry.observation().sources).toBe(0));
      expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
      expect(f.children).toHaveLength(1);
    },
  );

  it("rejects stale association epochs without sending or retiring the current source", async () => {
    const f = await fixture();
    const association = await f.registry.register(f.first.input);
    const stale = { associationId: association.associationId, sourceEpoch: randomUUID() };
    await expect(f.registry.status(stale)).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    await expect(f.registry.unregister(stale)).rejects.toMatchObject({ code: "SCOPE_CHANGED" });
    expect(await f.registry.status(reference(association))).toEqual(association);
  });

  it("reserves capacity before provider FS/startup await and admits four established sources", async () => {
    const f = await fixture();
    const release = f.hold();
    const endpoints = [
      f.first,
      ...(await Promise.all(Array.from({ length: 4 }, () => f.endpoint()))),
    ];
    const pending = endpoints.slice(0, 4).map((endpoint) => f.registry.register(endpoint.input));
    await expect(f.registry.register(endpoints[4].input)).rejects.toMatchObject({
      code: "CAPACITY",
    });
    expect(f.opens).toBe(4);
    release();
    await Promise.all(pending);
    expect(f.registry.observation()).toMatchObject({ sources: 4, activeHelpers: 4 });
  });

  it("retains a retiring lease until accepted status jobs and actual delayed process exit", async () => {
    const f = await fixture({
      registryOptions: { maxSources: 1 },
      config: { statusDelay: 100, exitDelay: 150 },
    });
    const association = await f.registry.register(f.first.input);
    const status = f.registry.status(reference(association));
    const retiring = f.registry.unregister(reference(association));
    const next = await f.endpoint();
    await expect(f.registry.register(next.input)).rejects.toMatchObject({ code: "CAPACITY" });
    expect(await status).toEqual(association);
    expect(await retiring).toMatchObject({ retired: true, qualified: false });
    expect(f.registry.observation().activeHelpers).toBe(0);
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
  });

  it("serializes bounded status work and lets heartbeat detect a real disconnect without replay", async () => {
    const f = await fixture({
      registryOptions: { heartbeatMs: 30, maxQueuedStatus: 1 },
      config: { statusDelay: 100, disconnectStatus: true },
    });
    const association = await f.registry.register(f.first.input);
    const first = f.registry.status(reference(association));
    await expect(f.registry.status(reference(association))).rejects.toMatchObject({
      code: "CAPACITY",
    });
    await expect(first).rejects.toMatchObject({ code: "TRANSPORT_UNKNOWN" });
    await vi.waitFor(() => expect(f.registry.observation().sources).toBe(0));
    expect(f.children).toHaveLength(1);
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
  });

  it("uses actual periodic status requests below native idle lifetime", async () => {
    const f = await fixture({ registryOptions: { heartbeatMs: 30 } });
    const association = await f.registry.register(f.first.input);
    await vi.waitFor(async () =>
      expect((await f.audit()).some((entry) => entry.kind === "source-status")).toBe(true),
    );
    await f.registry.unregister(reference(association));
    const statuses = (await f.audit()).filter((entry) => entry.kind === "source-status");
    expect(statuses.map((entry) => entry.requestId)).toEqual(statuses.map((_, index) => index + 1));
  });

  it("keeps failed tombstones bounded and lookup does not renew their TTL", async () => {
    const f = await fixture({
      registryOptions: { historyLimit: 1, tombstoneMs: 40 },
      config: { unavailable: true },
    });
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(f.opens).toBe(1);
    const fresh = await f.endpoint({ unavailable: false });
    await expect(f.registry.register(fresh.input)).rejects.toMatchObject({ code: "CAPACITY" });
    await new Promise((done) => setTimeout(done, 50));
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("absent");
    expect((await f.registry.register(fresh.input)).qualified).toBe(false);
  });

  it("rejects wrong environment/extra claimed scope before provider access", async () => {
    const f = await fixture();
    await expect(
      f.registry.register({ ...f.first.input, expectedHostEnvironmentId: "other" }),
    ).rejects.toMatchObject({ code: "ENVIRONMENT_CHANGED" });
    await expect(
      f.registry.register({ ...f.first.input, executablePath: process.execPath }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(f.opens).toBe(0);
  });

  it("settles a timed-out accepted hello through actual exit and keeps a failed tombstone", async () => {
    const f = await fixture({
      registryOptions: { operationTimeoutMs: 250 },
      config: { helloDelay: 700 },
    });
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({ code: "DEADLINE" });
    expect(f.children).toHaveLength(1);
    expect(f.children[0].exitCode !== null || f.children[0].signalCode !== null).toBe(true);
    expect(f.registry.observation()).toMatchObject({ sources: 0, activeHelpers: 0 });
    expect(f.registry.lookup(lookup(f.first.input)).state).toBe("failed");
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({ code: "DEADLINE" });
    expect(f.opens).toBe(1);
    expect((await f.audit()).filter((entry) => entry.kind === "source-hello")).toHaveLength(1);
  });

  it("bounds queued status lifetime from admission and never replays it after transport deadline", async () => {
    const f = await fixture({
      registryOptions: { operationTimeoutMs: 250 },
      config: { statusDelay: 700 },
    });
    const association = await f.registry.register(f.first.input);
    const outcomes = Promise.allSettled([
      f.registry.status(reference(association)),
      f.registry.status(reference(association)),
    ]);
    const settled = await outcomes;
    expect(settled[0]).toMatchObject({ status: "rejected", reason: { code: "DEADLINE" } });
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "SOURCE_CLOSED" } });
    await vi.waitFor(() => expect(f.registry.observation().sources).toBe(0));
    expect(f.provider.observation().activeHelpers).toBe(0);
    expect(f.opens).toBe(1);
    expect((await f.audit()).filter((entry) => entry.kind === "source-status")).toHaveLength(1);
  });

  it("close owns an in-flight provider operation until actual settlement and prevents later admission", async () => {
    const f = await fixture();
    const release = f.hold();
    const registration = f.registry.register(f.first.input);
    const outcome = registration.catch((error) => error);
    let finished = false;
    const closing = f.registry.close().then(() => {
      finished = true;
    });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await closing;
    expect(await outcome).toMatchObject({ code: "UNAVAILABLE" });
    expect(f.registry.observation()).toMatchObject({
      sources: 0,
      acceptedOperations: 0,
      activeHelpers: 0,
    });
    await expect(f.registry.register(f.first.input)).rejects.toMatchObject({ code: "SHUTDOWN" });
    expect(f.children).toHaveLength(0);
  });
});
