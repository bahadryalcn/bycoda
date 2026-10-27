import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import {
  HostAuthorityJournal,
  type AuthorityRequestContext,
  type AuthorityStage,
} from "./authority-journal";
import {
  hostAuthorityDecisionDigestInput,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import type { HostSession } from "../../src/features/connections/model/protocol";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-authority-journal-")),
    path = join(root, "host.db");
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const store = new HostStore(path);
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  const project = await store.addProject(root, "Fixture");
  const normalizedSnapshot: HostSession = {
    projectId: project.id,
    revision: 1,
    updatedAt: 7,
    status: "idle",
    session: {
      id: "native-session",
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
    },
  };
  const sourceJson = `${JSON.stringify(normalizedSnapshot.session, null, 2)}\n`;
  const fence: NativeFenceEvidence = {
    protocol: 2,
    environmentId: store.environmentId,
    sessionId: "native-session",
    migrationId: "migration",
    sourceProfileId: "profile",
    sourceStoreId: "native-store",
    generation: 2,
    sourceRevision: 7,
    sourceDigest: digest(sourceJson),
    snapshotEncoding: "source-json-utf8/v1",
    minWriterProtocol: 2,
    quiescent: true,
    unknownReservations: false,
    writerInventoryVerified: true,
    unsupportedWriters: false,
    evidenceDigest: "a".repeat(64),
  };
  const context: AuthorityRequestContext = {
    environmentId: fence.environmentId,
    sessionId: fence.sessionId,
    migrationId: fence.migrationId,
    sourceProfileId: fence.sourceProfileId,
    sourceStoreId: fence.sourceStoreId,
    nativeActorId: "fixture-native-actor",
    challenge: "fixture-challenge",
  };
  const verify = vi.fn(async (evidence: NativeFenceEvidence, request: AuthorityRequestContext) => {
    // Synthetic native authority for isolated tests, not a live IPC qualifier.
    if (
      request.nativeActorId !== "fixture-native-actor" ||
      request.challenge !== "fixture-challenge" ||
      evidence.evidenceDigest !== "a".repeat(64)
    )
      throw new Error("Untrusted native actor/challenge.");
  });
  const install = vi.fn(async (stage: AuthorityStage) => {
    await store.save(stage.normalizedSnapshot, { type: "authority-migration" });
  });
  const nativeAcknowledgements = new Set<string>();
  const journal = new HostAuthorityJournal({
    store,
    verifyNativeActorAndChallenge: verify,
    verifyNativeDecisionAcknowledgement: async (_fence, decision, request) => {
      if (
        request.nativeActorId !== "fixture-native-actor" ||
        !nativeAcknowledgements.has(decision.decisionDigest)
      )
        throw new Error("Native has not durably acknowledged this decision.");
    },
    installTarget: install,
  });
  await journal.ready;
  const stage = { fence, sourceJson, normalizedSnapshot, converterVersion: "native-session/v1" };
  const scope = {
    environmentId: fence.environmentId,
    sessionId: fence.sessionId,
    migrationId: fence.migrationId,
  };
  return {
    root,
    path,
    store,
    fence,
    context,
    scope,
    journal,
    stage,
    verify,
    install,
    nativeAcknowledgements,
  };
}

it("rejects a future writer floor before native verification or journal admission", async () => {
  const f = await fixture();
  await expect(f.journal.prepare({ ...f.fence, minWriterProtocol: 3 }, f.context)).rejects.toThrow(
    "supported Host writer protocol",
  );
  expect(f.verify).not.toHaveBeenCalled();
  expect(await f.journal.status(f.scope)).toBeUndefined();
});
it("preserves raw UTF8 source bytes, converter version and permanent terminal receipt across reopen", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  const decision = await f.journal.activate(f.fence, f.context);
  expect(decision.sourceDigest).toBe(digest(f.stage.sourceJson));
  expect(decision.sourceDigest).not.toBe(digest(JSON.stringify(JSON.parse(f.stage.sourceJson))));
  expect(decision.authorityGeneration).toBe(f.fence.generation);
  expect(decision.decisionDigest).toBe(digest(hostAuthorityDecisionDigestInput(decision)));
  expect(f.install).toHaveBeenCalledTimes(1);
  await f.store.pruneReceipts(Date.now() + 30 * 86400000);
  await f.store.close();
  const reopened = new HostStore(f.path);
  cleanups.push(() => reopened.close().catch(() => undefined));
  await reopened.ready;
  const install = vi.fn(async () => {
    throw new Error("must not reinstall");
  });
  const journal = new HostAuthorityJournal({
    store: reopened,
    verifyNativeActorAndChallenge: f.verify,
    installTarget: install,
  });
  expect(await journal.activate(f.fence, f.context)).toEqual(decision);
  expect(install).not.toHaveBeenCalled();
  const stored = await reopened.db
    .prepare("SELECT source_json,target_json,converter_version FROM host_authority_journal")
    .get();
  expect(stored?.source_json).toBe(f.stage.sourceJson);
  expect(stored?.converter_version).toBe("native-session/v1");
  expect(digest(String(stored?.target_json))).toBe(decision.targetDigest);
  expect((await reopened.session(f.fence.sessionId)).session.providerSessionId).toBe(
    "provider-resume",
  );
});

it("reopens a staged crash boundary without creating a Host conversation or unfreezing admission", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  await f.store.close();
  const reopened = new HostStore(f.path);
  cleanups.push(() => reopened.close().catch(() => undefined));
  await reopened.ready;
  const journal = new HostAuthorityJournal({
    store: reopened,
    verifyNativeActorAndChallenge: f.verify,
    installTarget: async () => {},
  });
  expect((await journal.status(f.scope))?.phase).toBe("staged");
  await expect(reopened.session(f.fence.sessionId)).rejects.toThrow();
  await expect(journal.assertHostWriteAllowed(f.fence.sessionId)).rejects.toThrow(
    "committed current generation",
  );
});

it.each(["activate", "abort"] as const)(
  "arbitrates concurrent %s-first terminal decisions with one winner",
  async (first) => {
    const f = await fixture();
    await f.journal.prepare(f.fence, f.context);
    await f.journal.stage(f.stage, f.context);
    const second = first === "activate" ? "abort" : "activate";
    const results = await Promise.allSettled([
      f.journal[first](f.fence, f.context),
      f.journal[second](f.fence, f.context),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const status = await f.journal.status(f.scope);
    expect(status?.phase).toBe(first === "activate" ? "host-active" : "aborted");
    if (first === "abort") {
      expect(status?.decision?.authorityGeneration).toBe(f.fence.generation + 1);
      expect(f.install).not.toHaveBeenCalled();
    }
  },
);

it("keeps exact prepare/stage/ack retries idempotent and rejects changed frozen bodies", async () => {
  const f = await fixture();
  const prepared = await f.journal.prepare(f.fence, f.context);
  expect(await f.journal.prepare(f.fence, f.context)).toEqual(prepared);
  const staged = await f.journal.stage(f.stage, f.context);
  expect(await f.journal.stage(f.stage, f.context)).toEqual(staged);
  await expect(f.journal.prepare({ ...f.fence, sourceRevision: 8 }, f.context)).rejects.toThrow(
    "frozen body",
  );
  await expect(
    f.journal.stage({ ...f.stage, converterVersion: "native-session/v2" }, f.context),
  ).rejects.toThrow("immutable snapshot");
  const decision = await f.journal.activate(f.fence, f.context);
  await expect(f.journal.ack(f.fence, "b".repeat(64), f.context)).rejects.toThrow("does not match");
  await expect(f.journal.ack(f.fence, decision.decisionDigest, f.context)).rejects.toThrow(
    "has not durably acknowledged",
  );
  expect((await f.journal.status(f.scope))?.acknowledged).toBe(false);
  f.nativeAcknowledgements.add(decision.decisionDigest);
  expect((await f.journal.ack(f.fence, decision.decisionDigest, f.context)).acknowledged).toBe(
    true,
  );
  expect((await f.journal.ack(f.fence, decision.decisionDigest, f.context)).acknowledged).toBe(
    true,
  );
});

it("requires a trusted native actor/challenge beyond serialized safety flags", async () => {
  const f = await fixture();
  await expect(
    f.journal.prepare(f.fence, { ...f.context, nativeActorId: "renderer" }),
  ).rejects.toThrow("Untrusted native actor");
  await expect(
    f.journal.prepare(f.fence, { ...f.context, challenge: "stale-challenge" }),
  ).rejects.toThrow("Untrusted native actor");
  expect(await f.journal.status(f.scope)).toBeUndefined();
});

it("rejects wrong environment/session/profile and unsafe generation/revision counters before writes", async () => {
  const f = await fixture();
  for (const context of [
    { ...f.context, environmentId: "wrong" },
    { ...f.context, sessionId: "wrong" },
    { ...f.context, sourceProfileId: "wrong" },
  ])
    await expect(f.journal.prepare(f.fence, context)).rejects.toThrow("scope");
  for (const fence of [
    { ...f.fence, generation: Number.MAX_SAFE_INTEGER + 1 },
    { ...f.fence, sourceRevision: -1 },
    { ...f.fence, generation: 0 },
  ])
    await expect(f.journal.prepare(fence, f.context)).rejects.toThrow();
  expect(f.verify).not.toHaveBeenCalled();
  expect(await f.journal.status(f.scope)).toBeUndefined();
});

it("retains prepared evidence on failed stage and rejects source digest/size and protected identity changes", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await expect(
    f.journal.stage({ ...f.stage, sourceJson: f.stage.sourceJson.trim() }, f.context),
  ).rejects.toThrow("digest");
  await expect(
    f.journal.stage({ ...f.stage, sourceJson: " ".repeat(32 * 1024 * 1024 + 1) }, f.context),
  ).rejects.toThrow("bytes");
  await expect(
    f.journal.stage(
      {
        ...f.stage,
        normalizedSnapshot: {
          ...f.stage.normalizedSnapshot,
          session: { ...f.stage.normalizedSnapshot.session, providerSessionId: "different" },
        },
      },
      f.context,
    ),
  ).rejects.toThrow("protected source");
  expect((await f.journal.status(f.scope))?.phase).toBe("prepared");
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow("immutable staged");
  expect(f.install).not.toHaveBeenCalled();
});

it("rolls back installed target and terminal receipt together without a commit wake", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  f.install.mockImplementation(async (stage) => {
    await f.store.save(stage.normalizedSnapshot, {});
    throw new Error("installer fault");
  });
  const wake = vi.fn();
  const authority = vi.fn();
  f.store.subscribeAuthorityChanges(authority);
  f.store.subscribeChanges(wake);
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow("installer fault");
  expect(wake).not.toHaveBeenCalled();
  expect(authority).not.toHaveBeenCalled();
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  await expect(f.store.session(f.fence.sessionId)).rejects.toThrow();
  expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(1);
});

it("invalidates same-revision authority metadata once after the terminal commit", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  const events: unknown[] = [];
  const reads: Promise<unknown>[] = [];
  f.store.subscribeAuthorityChanges((event) => {
    expect(f.store.transactionActive).toBe(false);
    expect(Object.isFrozen(event)).toBe(true);
    events.push(event);
    reads.push(f.store.session(event.sessionId));
  });
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  f.store.subscribeAuthorityChanges(() => {
    throw new Error("subscriber fault");
  });
  const survivor = vi.fn();
  const unsubscribe = f.store.subscribeAuthorityChanges(survivor);
  await f.journal.activate(f.fence, f.context);
  expect(events).toEqual([
    {
      sessionId: f.fence.sessionId,
      authorityGeneration: f.fence.generation,
      phase: "host-active",
      projectId: f.stage.normalizedSnapshot.projectId,
    },
  ]);
  expect((await reads[0]) as HostSession).toMatchObject({
    revision: f.stage.normalizedSnapshot.revision,
    authorityGeneration: f.fence.generation,
  });
  expect(survivor).toHaveBeenCalledTimes(1);
  unsubscribe();
  await f.journal.activate(f.fence, f.context);
  expect(events).toHaveLength(1);
  expect(quiet).toHaveBeenCalledTimes(1);
});

it("drops a queued authority event when an enclosing transaction rolls back", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  const listener = vi.fn();
  const unsubscribe = f.store.subscribeAuthorityChanges(listener);
  await expect(
    f.store.transaction(async () => {
      f.store.authorityDecisionCommitted({
        sessionId: f.fence.sessionId,
        authorityGeneration: f.fence.generation + 1,
        phase: "aborted",
      });
      expect(listener).not.toHaveBeenCalled();
      throw new Error("outer rollback");
    }),
  ).rejects.toThrow("outer rollback");
  expect(listener).not.toHaveBeenCalled();
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  await f.journal.abort(f.fence, f.context);
  expect(listener).toHaveBeenCalledExactlyOnceWith({
    sessionId: f.fence.sessionId,
    authorityGeneration: f.fence.generation + 1,
    phase: "aborted",
    projectId: f.stage.normalizedSnapshot.projectId,
  });
  await f.journal.abort(f.fence, f.context);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});

it("unsubscribes authority listeners and clears them on close", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  const removed = vi.fn();
  const unsubscribe = f.store.subscribeAuthorityChanges(removed);
  unsubscribe();
  await f.journal.abort(f.fence, f.context);
  expect(removed).not.toHaveBeenCalled();
  await f.store.close();
  const afterClose = f.store.subscribeAuthorityChanges(vi.fn());
  expect(() => afterClose()).not.toThrow();
});

it("uses FULL for the SQL installer and only publishes the complete committed target", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  f.install.mockImplementation(async (stage) => {
    expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(2);
    await f.store.save(stage.normalizedSnapshot, {});
  });
  const wakes: Promise<unknown>[] = [];
  f.store.subscribeChanges(() => {
    wakes.push(f.journal.status(f.scope));
  });
  const active = await f.journal.activate(f.fence, f.context);
  expect((await Promise.all(wakes))[0]).toMatchObject({ phase: "host-active", decision: active });
});

it("rejects existing Host content before prepare and fences late old Host writes", async () => {
  const f = await fixture();
  await f.store.save(f.stage.normalizedSnapshot, {});
  await expect(f.journal.prepare(f.fence, f.context)).rejects.toThrow("cannot overwrite");
  expect((await f.store.session(f.fence.sessionId)).session.title).toBe("Original ü/🙂");
  const g = await fixture();
  await g.journal.prepare(g.fence, g.context);
  await g.journal.stage(g.stage, g.context);
  await expect(
    g.store.save(
      {
        ...g.stage.normalizedSnapshot,
        session: { ...g.stage.normalizedSnapshot.session, title: "Independent Host content" },
      },
      {},
    ),
  ).rejects.toThrow("current generation");
  await g.journal.activate(g.fence, g.context);
  expect((await g.store.session(g.fence.sessionId)).session.title).toBe("Original ü/🙂");
});

it("blocks terminal writes while persistence is degraded without deleting prepared evidence", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  await f.store.db.exec("CREATE TABLE full_authority_fixture(value BLOB)");
  const pages = (await f.store.db.prepare("PRAGMA page_count").get())?.page_count;
  await f.store.db.exec(`PRAGMA max_page_count=${pages}`);
  await expect(
    f.store.db.prepare("INSERT INTO full_authority_fixture VALUES(zeroblob(1048576))").run(),
  ).rejects.toThrow();
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
    "persistence is unavailable",
  );
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  expect(f.install).not.toHaveBeenCalled();
});

it("retains monotonic generation tombstones after abort and requires current generation for Host writes", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.abort(f.fence, f.context);
  const migrationId = "migration-next",
    context = { ...f.context, migrationId };
  await expect(
    f.journal.prepare({ ...f.fence, migrationId, generation: 3 }, context),
  ).rejects.toThrow("stale");
  await expect(
    f.journal.prepare(
      { ...f.fence, migrationId, generation: 4, sourceProfileId: "another-profile" },
      { ...context, sourceProfileId: "another-profile" },
    ),
  ).rejects.toThrow("store/profile changed");
  const next = { ...f.fence, migrationId, generation: 4 };
  await f.journal.prepare(next, context);
  await f.journal.stage({ ...f.stage, fence: next }, context);
  await f.journal.activate(next, context);
  await expect(f.journal.assertHostWriteAllowed(next.sessionId)).rejects.toThrow(
    "current generation",
  );
  await expect(f.journal.assertHostWriteAllowed(next.sessionId, 2)).rejects.toThrow(
    "current generation",
  );
  await expect(f.journal.assertHostWriteAllowed(next.sessionId, 4)).resolves.toBeUndefined();
});

it("holds max-safe abort overflow and rejects tampered staged or terminal data", async () => {
  const f = await fixture();
  const overflow = { ...f.fence, generation: Number.MAX_SAFE_INTEGER };
  await f.journal.prepare(overflow, f.context);
  await expect(f.journal.abort(overflow, f.context)).rejects.toThrow();
  expect((await f.journal.status(f.scope))?.phase).toBe("prepared");
  const g = await fixture();
  await g.journal.prepare(g.fence, g.context);
  await g.journal.stage(g.stage, g.context);
  await g.store.db.prepare("UPDATE host_authority_journal SET target_json=?").run("{}");
  await expect(g.journal.activate(g.fence, g.context)).rejects.toThrow("integrity");
  expect(g.install).not.toHaveBeenCalled();
  const h = await fixture();
  await h.journal.prepare(h.fence, h.context);
  const aborted = await h.journal.abort(h.fence, h.context);
  await h.store.db
    .prepare("UPDATE host_authority_journal SET decision=?")
    .run(JSON.stringify({ ...aborted, committedAt: aborted.committedAt + 1 }));
  await expect(h.journal.status(h.scope)).rejects.toThrow("integrity");
  await expect(h.journal.ack(h.fence, aborted.decisionDigest, h.context)).rejects.toThrow(
    "integrity",
  );
});

it("installer mutations cannot change the immutable expected normalized snapshot", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, f.context);
  await f.journal.stage(f.stage, f.context);
  f.install.mockImplementation(async (stage) => {
    stage.normalizedSnapshot.session.title = "Unexpected converter mutation";
    await f.store.save(stage.normalizedSnapshot, {});
  });
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
    "did not persist the staged",
  );
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  await expect(f.store.session(f.fence.sessionId)).rejects.toThrow();
});
