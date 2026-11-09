import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { HostStore } from "../store";
import { HostAuthorityJournal, type AuthorityRequestContext } from "./authority-journal";
import { createNativeTargetInstaller } from "./native-target-installer";
import {
  createNativeSnapshotConverter,
  type NativeMigrationTarget,
} from "./native-snapshot-converter";
import {
  hostAuthorityDecisionDigestInput,
  NativeFenceEvidenceSchema,
  type NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";
import capturedFixture from "./fixtures/native-snapshot-v1.json";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  const temporary = await realpath(tmpdir());
  const root = await realpath(await mkdtemp(join(temporary, "bycoda-native-target-")));
  cleanups.push(async () => {
    const target = resolve(root);
    if (
      dirname(target).toLowerCase() !== temporary.toLowerCase() ||
      !basename(target).startsWith("bycoda-native-target-") ||
      (await realpath(target)).toLowerCase() !== target.toLowerCase()
    )
      throw new Error("Unsafe native target fixture cleanup");
    await rm(target, { recursive: true, force: true });
  });
  const path = join(root, "host.db");
  const store = new HostStore(path);
  cleanups.push(() => store.close());
  await store.ready;
  // The maintained sanitized derivative supplies the real Native row shape.
  // This case adds synthetic client state; its verifier remains a test double,
  // never evidence of a supported cohort, source fence or qualified actor.
  const source = JSON.parse(capturedFixture.sourceJson);
  const project = await store.addProject(source.session.cwd, "Owned project");
  source.session.worktreeCwd = "/fixture/separate-native-worktree";
  source.retainedNativeRows.sessions[0].worktree_cwd = source.session.worktreeCwd;
  source.clientOwnedQueue = [{ id: "client-row", text: "Client-owned only", attachments: [] }];
  source.clientOwnedDraftJson = '{"text":"private unsent draft","mcpTags":[],"attachments":[]}';
  source.retainedNativeRows.session_queues = [
    {
      session_id: source.session.id,
      queue_json: JSON.stringify(source.clientOwnedQueue),
      updated_at: source.session.updatedAt,
    },
  ];
  source.retainedNativeRows.composer_drafts = [
    {
      session_id: source.session.id,
      draft_json: source.clientOwnedDraftJson,
      updated_at: source.session.updatedAt,
    },
  ];
  const sourceJson = `${JSON.stringify(source, null, 2)}\n`;
  const fence = NativeFenceEvidenceSchema.parse({
    ...capturedFixture.fence,
    environmentId: store.environmentId,
    sourceDigest: hash(sourceJson),
  });
  const context: AuthorityRequestContext = {
    environmentId: fence.environmentId,
    sessionId: fence.sessionId,
    migrationId: fence.migrationId,
    sourceProfileId: fence.sourceProfileId,
    sourceStoreId: fence.sourceStoreId,
    nativeActorId: "synthetic-fixture-actor",
    challenge: "synthetic-fixture-challenge",
  };
  const converter = createNativeSnapshotConverter({
    projectId: project.id,
    expectedCwd: project.cwd,
  });
  const target = converter.convert(source, fence) as NativeMigrationTarget;
  const stage = {
    fence,
    sourceJson,
    normalizedSnapshot: target,
    converterVersion: converter.version,
  };
  const realInstall = createNativeTargetInstaller({
    store,
    projectId: project.id,
    expectedCwd: project.cwd,
  });
  const install = vi.fn(realInstall);
  const verifyNativeActorAndChallenge = async (
    evidence: NativeFenceEvidence,
    request: AuthorityRequestContext,
  ) => {
    if (
      evidence.evidenceDigest !== fence.evidenceDigest ||
      request.nativeActorId !== context.nativeActorId ||
      request.challenge !== context.challenge
    )
      throw new Error("Synthetic fixture actor rejected");
  };
  const journal = new HostAuthorityJournal({
    store,
    verifyNativeActorAndChallenge,
    installTarget: install,
  });
  await journal.ready;
  const scope = {
    environmentId: fence.environmentId,
    sessionId: fence.sessionId,
    migrationId: fence.migrationId,
  };
  const prepare = async (input = stage) => {
    await journal.prepare(fence, context);
    await journal.stage(input, context);
  };
  return {
    root,
    path,
    store,
    project,
    source,
    sourceJson,
    fence,
    context,
    target,
    stage,
    realInstall,
    install,
    verifyNativeActorAndChallenge,
    journal,
    scope,
    prepare,
  };
}

async function expectUninstalled(f: Awaited<ReturnType<typeof fixture>>) {
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  expect(
    await f.store.db.prepare("SELECT id FROM sessions WHERE id=?").get(f.fence.sessionId),
  ).toBeUndefined();
  expect(
    await f.store.db.prepare("SELECT id FROM session_state WHERE id=?").get(f.fence.sessionId),
  ).toBeUndefined();
  expect(
    await f.store.db
      .prepare("SELECT session_id FROM events WHERE session_id=?")
      .get(f.fence.sessionId),
  ).toBeUndefined();
  expect(
    (
      await f.store.db
        .prepare("SELECT phase FROM host_authority_heads WHERE session_id=?")
        .get(f.fence.sessionId)
    )?.phase,
  ).toBe("native-fenced");
}

it("atomically installs only the Host projection, retaining the complete private source/target across reopen and terminal retry", async () => {
  const f = await fixture();
  await f.prepare();
  const wake = vi.fn();
  const authority = vi.fn();
  f.store.subscribeChanges(wake);
  f.store.subscribeAuthorityChanges(authority);
  f.install.mockImplementation(async (stage, decision) => {
    expect((await f.store.db.prepare("PRAGMA synchronous").get())?.synchronous).toBe(2);
    expect(f.store.transactionActive).toBe(true);
    await f.realInstall(stage, decision);
    expect(wake).not.toHaveBeenCalled();
    expect(authority).not.toHaveBeenCalled();
  });
  const decision = await f.journal.activate(f.fence, f.context);
  const installed = await f.store.session(f.fence.sessionId);
  expect(installed).toMatchObject(f.target.hostSession);
  expect(installed.session.cwd).toBe(f.project.cwd);
  expect(installed.session.worktreeCwd).toBe(f.source.session.worktreeCwd);
  expect(installed.authorityGeneration).toBe(f.fence.generation);
  const saved = await f.store.db
    .prepare("SELECT snapshot,summary FROM sessions WHERE id=?")
    .get(f.fence.sessionId);
  expect(String(saved?.snapshot)).not.toMatch(
    /nativePreservation|private unsent draft|fixturePrivateRows|native-session-target/,
  );
  expect(String(saved?.summary)).not.toMatch(
    /nativePreservation|private unsent draft|fixturePrivateRows/,
  );
  expect(
    (
      await f.store.db
        .prepare("SELECT revision FROM session_state WHERE id=?")
        .get(f.fence.sessionId)
    )?.revision,
  ).toBe(installed.revision);
  expect(
    await f.store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='session_queues'")
      .get(),
  ).toBeUndefined();
  expect(authority).toHaveBeenCalledOnce();
  expect(wake).toHaveBeenCalledOnce();
  const retained = await f.store.db
    .prepare(
      "SELECT source_json,target_json,target_digest,converter_version,decision FROM host_authority_journal WHERE migration_id=?",
    )
    .get(f.fence.migrationId);
  expect(retained?.source_json).toBe(f.sourceJson);
  expect(JSON.parse(String(retained?.target_json))).toEqual(f.target);
  expect(hash(String(retained?.target_json))).toBe(
    decision.phase === "host-active" ? decision.targetDigest : "wrong phase",
  );
  const event = await f.store.db
    .prepare("SELECT payload FROM events WHERE session_id=?")
    .get(f.fence.sessionId);
  expect(String(event?.payload)).not.toMatch(
    /nativePreservation|private unsent draft|fixturePrivateRows/,
  );
  expect(
    (await f.store.db.prepare("SELECT COUNT(*) AS count FROM host_authority_write_permits").get())
      ?.count,
  ).toBe(0);

  await f.store.close();
  const reopened = new HostStore(f.path);
  cleanups.push(() => reopened.close());
  await reopened.ready;
  const retryInstall = vi.fn(
    createNativeTargetInstaller({
      store: reopened,
      projectId: f.project.id,
      expectedCwd: f.project.cwd,
    }),
  );
  const journal = new HostAuthorityJournal({
    store: reopened,
    verifyNativeActorAndChallenge: f.verifyNativeActorAndChallenge,
    installTarget: retryInstall,
  });
  await journal.ready;
  expect(await journal.activate(f.fence, f.context)).toEqual(decision);
  expect(retryInstall).not.toHaveBeenCalled();
  expect(await reopened.session(f.fence.sessionId)).toMatchObject(f.target.hostSession);
  expect(
    (
      await reopened.db
        .prepare("SELECT COUNT(*) AS count FROM events WHERE session_id=?")
        .get(f.fence.sessionId)
    )?.count,
  ).toBe(1);
});

it("returns the permanent activation receipt without replaying installation over a later Host edit", async () => {
  const f = await fixture();
  await f.prepare();
  const decision = await f.journal.activate(f.fence, f.context);
  const original = await f.store.session(f.fence.sessionId);
  const edited = await f.store.save(
    {
      ...original,
      revision: original.revision + 1,
      updatedAt: original.updatedAt + 1,
      session: { ...original.session, title: "Later accepted Host edit" },
    },
    { type: "fixture-host-edit" },
  );
  expect(await f.journal.activate(f.fence, f.context)).toEqual(decision);
  expect(f.install).toHaveBeenCalledOnce();
  expect(await f.store.session(f.fence.sessionId)).toEqual(edited);
  expect(
    JSON.parse(
      String(
        (
          await f.store.db
            .prepare("SELECT target_json FROM host_authority_journal WHERE migration_id=?")
            .get(f.fence.migrationId)
        )?.target_json,
      ),
    ),
  ).toEqual(f.target);
});

it("rolls back target, mirrors, events, terminal head and notifications together after a post-write fault", async () => {
  const f = await fixture();
  await f.prepare();
  const wake = vi.fn();
  const authority = vi.fn();
  f.store.subscribeChanges(wake);
  f.store.subscribeAuthorityChanges(authority);
  f.install.mockImplementation(async (stage, decision) => {
    await f.realInstall(stage, decision);
    throw new Error("post-install fixture fault");
  });
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
    "post-install fixture fault",
  );
  await expectUninstalled(f);
  expect(wake).not.toHaveBeenCalled();
  expect(authority).not.toHaveBeenCalled();
  expect(
    (
      await f.store.db
        .prepare("SELECT source_json FROM host_authority_journal WHERE migration_id=?")
        .get(f.fence.migrationId)
    )?.source_json,
  ).toBe(f.sourceJson);
  f.install.mockImplementation(f.realInstall);
  await f.journal.activate(f.fence, f.context);
  expect(authority).toHaveBeenCalledOnce();
});

it.each(["changed", "removed"])(
  "rejects a registered project %s after staging without creating a replacement project",
  async (mode) => {
    const f = await fixture();
    await f.prepare();
    if (mode === "changed")
      await f.store.db
        .prepare("UPDATE projects SET cwd=? WHERE id=?")
        .run(join(f.root, "different-root"), f.project.id);
    else await f.store.db.prepare("DELETE FROM projects WHERE id=?").run(f.project.id);
    const save = vi.spyOn(f.store, "save");
    await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    await expectUninstalled(f);
    expect((await f.store.projects()).length).toBe(mode === "changed" ? 1 : 0);
  },
);

it("rejects a callback converter version change before writing the target", async () => {
  const f = await fixture();
  await f.prepare();
  const save = vi.spyOn(f.store, "save");
  f.install.mockImplementation((stage, decision) =>
    f.realInstall({ ...stage, converterVersion: "unsupported-converter/v99" }, decision),
  );
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow("converter version changed");
  expect(save).not.toHaveBeenCalled();
  await expectUninstalled(f);
});

it("rejects a callback target mutation even when the private staged bytes stay intact", async () => {
  const f = await fixture();
  await f.prepare();
  const save = vi.spyOn(f.store, "save");
  f.install.mockImplementation(async (stage, decision) => {
    const changed = structuredClone(stage);
    (changed.normalizedSnapshot as NativeMigrationTarget).hostSession.session.title =
      "callback mutation";
    await f.realInstall(changed, decision);
  });
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow("callback target changed");
  expect(save).not.toHaveBeenCalled();
  await expectUninstalled(f);
});

it("reconverts source preservation instead of accepting a self-consistent rehashed target mutation", async () => {
  const f = await fixture();
  await f.prepare();
  const save = vi.spyOn(f.store, "save");
  f.install.mockImplementation(async (stage, decision) => {
    const changed = structuredClone(stage);
    const preservation = (changed.normalizedSnapshot as NativeMigrationTarget).nativePreservation;
    preservation.clientOwnedDraftJson =
      '{"text":"changed private draft","mcpTags":[],"attachments":[]}';
    preservation.retainedNativeRows.composer_drafts[0].draft_json =
      preservation.clientOwnedDraftJson;
    const targetJson = JSON.stringify(changed.normalizedSnapshot);
    changed.targetDigest = hash(targetJson);
    if (decision.phase !== "host-active") throw new Error("Unexpected fixture phase");
    const changedDecision = { ...decision, targetDigest: changed.targetDigest };
    changedDecision.decisionDigest = hash(hostAuthorityDecisionDigestInput(changedDecision));
    // Fault injection changes an actual production-created journal row inside
    // its transaction. It does not fabricate a replacement journal/schema.
    await f.store.db
      .prepare(
        "UPDATE host_authority_journal SET target_json=?,target_digest=?,decision=? WHERE migration_id=?",
      )
      .run(targetJson, changed.targetDigest, JSON.stringify(changedDecision), f.fence.migrationId);
    await f.realInstall(changed, changedDecision);
  });
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
    "source preservation or normalized target changed",
  );
  expect(save).not.toHaveBeenCalled();
  await expectUninstalled(f);
});

it.each(["source_json", "target_json"])(
  "rejects altered retained %s bytes before any session write",
  async (column) => {
    const f = await fixture();
    await f.prepare();
    const save = vi.spyOn(f.store, "save");
    f.install.mockImplementation(async (stage, decision) => {
      const changed = { ...stage };
      if (column === "source_json") changed.sourceJson += " ";
      await f.store.db
        .prepare(
          `UPDATE host_authority_journal SET ${column}=${column} || ' ' WHERE migration_id=?`,
        )
        .run(f.fence.migrationId);
      await f.realInstall(changed, decision);
    });
    await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
      "immutable snapshot bytes changed",
    );
    expect(save).not.toHaveBeenCalled();
    await expectUninstalled(f);
  },
);

it("rejects a changed current head generation inside the actual activation transaction", async () => {
  const f = await fixture();
  await f.prepare();
  const save = vi.spyOn(f.store, "save");
  f.install.mockImplementation(async (stage, decision) => {
    await f.store.db
      .prepare("UPDATE host_authority_heads SET generation=generation+1 WHERE session_id=?")
      .run(f.fence.sessionId);
    await f.realInstall(stage, decision);
  });
  await expect(f.journal.activate(f.fence, f.context)).rejects.toThrow(
    "current journal installation does not match",
  );
  expect(save).not.toHaveBeenCalled();
  await expectUninstalled(f);
});

it("requires a real critical journal transaction and never overwrites an already installed session", async () => {
  const f = await fixture();
  await f.prepare();
  const decision = await f.journal.activate(f.fence, f.context);
  const installedStage = f.install.mock.calls[0][0];
  const before = await f.store.session(f.fence.sessionId);
  const save = vi.spyOn(f.store, "save");
  await expect(f.realInstall(installedStage, decision)).rejects.toThrow(
    "critical journal transaction required",
  );
  await expect(
    f.store.transaction(() => f.realInstall(installedStage, decision), "checkpoint"),
  ).rejects.toThrow("critical storage transaction");
  await expect(
    f.store.transaction(() => f.realInstall(installedStage, decision), "critical"),
  ).rejects.toThrow("existing Host session cannot be overwritten");
  expect(save).not.toHaveBeenCalled();
  expect(await f.store.session(f.fence.sessionId)).toEqual(before);
});
