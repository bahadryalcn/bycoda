import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import captured from "./fixtures/native-snapshot-v1.json";
import { HostStore } from "../store";
import { HostAuthorityJournal, type AuthorityRequestContext } from "./authority-journal";
import {
  HostAuthorityCoordinator,
  type AuthenticatedNativeAuthorityPort,
  type AuthorityCoordinatorStep,
} from "./authority-coordinator";
import {
  createNativeSnapshotConverter,
  validateNativeMigrationTarget,
} from "./native-snapshot-converter";
import { createNativeTargetInstaller } from "./native-target-installer";
import { SessionViewSchema } from "../../src/shared/model/host-contracts/session-reads";
import type {
  HostAuthorityDecision,
  NativeFenceEvidence,
} from "../../src/shared/model/host-contracts/authority";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

async function fixture() {
  const parent = await realpath(tmpdir());
  const directory = await mkdtemp(join(parent, "bycoda-target-coordinator-"));
  cleanups.push(async () => {
    const target = resolve(directory);
    if (
      dirname(target) !== parent ||
      !basename(target).startsWith("bycoda-target-coordinator-") ||
      (await realpath(target)) !== target
    )
      throw new Error("Unexpected target fixture cleanup path");
    await rm(target, { recursive: true, force: true });
  });
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => store.close());
  await store.ready;
  const source = JSON.parse(captured.sourceJson);
  const project = await store.addProject(source.session.cwd, "Native target fixture");
  const sourceJson = JSON.stringify(source);
  const fence: NativeFenceEvidence = {
    ...captured.fence,
    protocol: 2,
    snapshotEncoding: "source-json-utf8/v1",
    environmentId: store.environmentId,
    sourceDigest: hash(sourceJson),
  };
  const scope = {
    environmentId: fence.environmentId,
    sessionId: fence.sessionId,
    migrationId: fence.migrationId,
  };
  const issued = new Map<string, AuthorityCoordinatorStep>();
  const handles = new WeakMap<object, HostAuthorityDecision>();
  let durable: HostAuthorityDecision | undefined;
  const use = (context: AuthorityRequestContext, step?: AuthorityCoordinatorStep) => {
    const actual = issued.get(context.challenge);
    if (
      !actual ||
      (step && actual !== step) ||
      context.nativeActorId !== "synthetic-target-coordinator" ||
      context.sourceProfileId !== fence.sourceProfileId ||
      context.sourceStoreId !== fence.sourceStoreId ||
      context.environmentId !== fence.environmentId ||
      context.sessionId !== fence.sessionId ||
      context.migrationId !== fence.migrationId
    )
      throw new Error("Synthetic fixture actor/challenge rejected");
    issued.delete(context.challenge);
  };
  // Explicit test double only. It does not qualify any production native actor,
  // writer census, transport, disk write or installed application.
  const native: AuthenticatedNativeAuthorityPort = {
    authenticatedContext: async (requested, step) => {
      expect(requested).toEqual(scope);
      const challenge = randomUUID();
      issued.set(challenge, step);
      return {
        ...scope,
        sourceProfileId: fence.sourceProfileId,
        sourceStoreId: fence.sourceStoreId,
        nativeActorId: "synthetic-target-coordinator",
        challenge,
      };
    },
    readFenceSnapshot: async (context) => {
      use(context, "read-snapshot");
      return { fence, sourceJson };
    },
    cancelQuiesce: async (_expected, context) => {
      use(context, "cancel-quiesce");
      return { kind: "fenced", snapshot: { fence, sourceJson } };
    },
    quiesceAndFence: async () => {
      throw new Error("Fixture source is already fenced");
    },
    verifyHostDecision: async (decision, context) => {
      use(context, "verify-decision");
      const handle = {};
      handles.set(handle, structuredClone(decision));
      return handle;
    },
    applyVerifiedDecision: async (handle, context) => {
      use(context, "apply-decision");
      const decision = handles.get(handle);
      if (!decision) throw new Error("Missing synthetic native handle");
      handles.delete(handle);
      durable = decision;
    },
    readDecisionAcknowledgement: async (decision, context) => {
      use(context, "read-native-ack");
      expect(durable?.decisionDigest).toBe(decision.decisionDigest);
      return structuredClone(durable!);
    },
  };
  const converter = createNativeSnapshotConverter({
    projectId: project.id,
    expectedCwd: source.session.cwd,
  });
  const install = vi.fn(
    createNativeTargetInstaller({ store, projectId: project.id, expectedCwd: source.session.cwd }),
  );
  const journal = new HostAuthorityJournal({
    store,
    verifyNativeActorAndChallenge: async (actual, context) => {
      use(context);
      expect(actual).toEqual(fence);
    },
    verifyNativeDecisionAcknowledgement: async (_fence, decision) => {
      if (durable?.decisionDigest !== decision.decisionDigest)
        throw new Error("Synthetic native ACK missing");
    },
    installTarget: install,
  });
  const coordinator = new HostAuthorityCoordinator({
    scope,
    expectedSourceGeneration: fence.generation - 1,
    journal,
    native,
    converter,
  });
  const privateReadContext = () => native.authenticatedContext(scope, "read-snapshot");
  return {
    store,
    source,
    sourceJson,
    fence,
    scope,
    native,
    converter,
    install,
    journal,
    coordinator,
    privateReadContext,
  };
}

it("coordinates a private target and keeps session/event projections free of recovery data", async () => {
  const f = await fixture();
  const result = await f.coordinator.migrate();
  expect(result.status.acknowledged).toBe(true);
  expect(f.install).toHaveBeenCalledOnce();
  const installed = await f.store.session(f.scope.sessionId);
  expect(SessionViewSchema.safeParse(installed).success).toBe(true);
  expect(installed.session.blocks).toEqual(f.source.session.blocks);
  expect(installed).not.toHaveProperty("nativePreservation");
  const row = await f.store.db
    .prepare("SELECT target_json,source_json FROM host_authority_journal WHERE migration_id=?")
    .get(f.scope.migrationId);
  const target = validateNativeMigrationTarget(JSON.parse(String(row!.target_json)));
  expect(target.nativePreservation.retainedNativeRows).toEqual(f.source.retainedNativeRows);
  expect(row!.source_json).toBe(f.sourceJson);
  const retained = await f.journal.readNativePreservation(f.fence, await f.privateReadContext());
  expect(retained).toEqual(target.nativePreservation);
});

it("requires a fresh correctly scoped native challenge for private recovery reads", async () => {
  const f = await fixture();
  await f.coordinator.migrate();
  const context = await f.privateReadContext();
  await f.journal.readNativePreservation(f.fence, context);
  await expect(f.journal.readNativePreservation(f.fence, context)).rejects.toThrow(
    "actor/challenge",
  );
  await expect(
    f.journal.readNativePreservation(f.fence, {
      ...(await f.privateReadContext()),
      sourceProfileId: "other-profile",
    }),
  ).rejects.toThrow("scope");
});

it("rejects a bare target that would omit the Native source's private recovery envelope", async () => {
  const f = await fixture();
  await f.journal.prepare(f.fence, await f.native.authenticatedContext(f.scope, "prepare"));
  const target = validateNativeMigrationTarget(f.converter.convert(f.source, f.fence));
  await expect(
    f.journal.stage(
      {
        fence: f.fence,
        sourceJson: f.sourceJson,
        normalizedSnapshot: target.hostSession,
        converterVersion: f.converter.version,
      },
      await f.native.authenticatedContext(f.scope, "stage"),
    ),
  ).rejects.toThrow("private preservation target");
  expect((await f.journal.status(f.scope))?.phase).toBe("prepared");
  expect(f.install).not.toHaveBeenCalled();
});

it("does not reinstall an acknowledged target over later Host work on recovery", async () => {
  const f = await fixture();
  const first = await f.coordinator.migrate();
  const current = await f.store.session(f.scope.sessionId);
  await f.store.withAuthorityGeneration(f.scope.sessionId, first.decision.authorityGeneration, () =>
    f.store.save(
      {
        ...current,
        revision: current.revision + 1,
        session: { ...current.session, title: "Later Host edit" },
      },
      {},
    ),
  );
  const recovered = await f.coordinator.recover();
  expect(recovered.decision).toEqual(first.decision);
  expect(f.install).toHaveBeenCalledOnce();
  expect((await f.store.session(f.scope.sessionId)).session.title).toBe("Later Host edit");
});

it("rejects retained target corruption on status, retry and private recovery reads", async () => {
  const f = await fixture();
  await f.coordinator.migrate();
  await f.store.transaction(() =>
    f.store.db
      .prepare("UPDATE host_authority_journal SET target_json='{}' WHERE migration_id=?")
      .run(f.scope.migrationId),
  );
  await expect(f.journal.status(f.scope)).rejects.toThrow("snapshot integrity");
  await expect(f.coordinator.recover()).rejects.toThrow("snapshot integrity");
  await expect(
    f.journal.readNativePreservation(f.fence, await f.privateReadContext()),
  ).rejects.toThrow("snapshot integrity");
  expect(f.install).toHaveBeenCalledOnce();
});

it.each([
  [
    "private target",
    "UPDATE host_authority_journal SET target_json='{}' WHERE migration_id=?",
    "snapshot integrity",
  ],
  [
    "native ACK",
    "UPDATE host_authority_journal SET acknowledged=1 WHERE migration_id=?",
    "immutable migration",
  ],
  [
    "authority head",
    "UPDATE host_authority_heads SET migration_id='other' WHERE migration_id=?",
    "authority head",
  ],
])("rolls back a callback that changes %s after installing", async (_name, sql, message) => {
  const f = await fixture();
  const factory = f.install.getMockImplementation()!;
  f.install.mockImplementation(async (stage, decision) => {
    await factory(stage, decision);
    await f.store.db.prepare(sql).run(f.scope.migrationId);
  });
  await expect(f.coordinator.migrate()).rejects.toThrow(message);
  expect((await f.journal.status(f.scope))?.phase).toBe("staged");
  await expect(f.store.session(f.scope.sessionId)).rejects.toThrow();
});
