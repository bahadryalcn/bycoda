import { afterEach, expect, it, vi } from "vitest";
import { setupDesktopHost } from "../desktop/desktopSessionFixture";
import { currentRequestTrace } from "../diagnostics/request-trace";
import { HostAuthorityFenceError } from "../storage/authority-fence";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function hostedSession() {
  const s = await setupDesktopHost(cleanups);
  const created = await s.call("commands.dispatch", {
    type: "create",
    workspaceMode: "current",
    commandId: "scope-create",
    projectId: s.project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  });
  const sessionId = String(created.result.sessionId);
  return { s, sessionId };
}

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}

it("keeps a warm sessions.sync to the catch-up and coherent session admissions", async () => {
  const { s, sessionId } = await hostedSession();
  const first = (await s.call("sessions.sync", { sessionId })).result;
  // Credential cache expiry is time based and is not part of the read path being counted.
  vi.spyOn(s.store, "authenticated").mockResolvedValue(true);
  let writerAdmissions = 0;
  const scope = s.store.db.scope.bind(s.store.db) as typeof s.store.db.scope;
  vi.spyOn(s.store.db, "scope").mockImplementation(((...args: Parameters<typeof scope>) => {
    if (currentRequestTrace() && !s.store.db.ownsScope) writerAdmissions++;
    return scope(...args);
  }) as never);
  const next = await s.call("sessions.sync", {
    sessionId,
    revision: first.value.revision,
    sourceEpoch: first.value.sourceEpoch,
  });
  expect(next.result).toMatchObject({ kind: "unchanged", revision: first.value.revision });
  expect(writerAdmissions).toBeGreaterThan(0);
  expect(writerAdmissions).toBeLessThanOrEqual(2);
});

it("reads session metadata while another scope holds the writer", async () => {
  const { s, sessionId } = await hostedSession();
  await s.store.flushAll();
  const expected = await s.store.sessionStateMetadata(sessionId);
  const entered = gate();
  const release = gate();
  const held = s.store.db.storeScope(async () => {
    entered.open();
    await release.opened;
  });
  await entered.opened;
  try {
    await expect(s.store.sessionReadMetadata(sessionId)).resolves.toMatchObject({
      projectId: expected?.projectId,
      revision: expected?.revision,
      status: expected?.status,
      desktop: expected?.desktop,
    });
  } finally {
    release.open();
    await held;
  }
});

it("never shows uncommitted state and shows it once committed", async () => {
  const { s, sessionId } = await hostedSession();
  await s.store.flushAll();
  const current = await s.store.session(sessionId);
  const entered = gate();
  const release = gate();
  const write = s.store.transaction(async () => {
    await s.store.save(
      { ...current, revision: current.revision + 1 },
      { type: "scope-test" },
      {
        deferred: true,
      },
    );
    entered.open();
    await release.opened;
  });
  await entered.opened;
  try {
    expect((await s.store.sessionReadMetadata(sessionId))?.revision).toBe(current.revision);
  } finally {
    release.open();
    await write;
  }
  expect((await s.store.sessionReadMetadata(sessionId))?.revision).toBe(current.revision + 1);
});

it("keeps an unwritten value visible while its checkpoint is being written", async () => {
  const { s, sessionId } = await hostedSession();
  await s.store.flushAll();
  const current = await s.store.session(sessionId);
  await s.store.save(
    { ...current, revision: current.revision + 1 },
    { type: "scope-test" },
    {
      deferred: true,
    },
  );
  const entered = gate();
  const release = gate();
  const target = s.store as unknown as { writeJournal(...args: unknown[]): Promise<void> };
  const writeJournal = target.writeJournal.bind(s.store);
  target.writeJournal = async (...args) => {
    entered.open();
    await release.opened;
    return writeJournal(...args);
  };
  const flushed = s.store.flushAll();
  await entered.opened;
  try {
    expect((await s.store.sessionReadMetadata(sessionId))?.revision).toBe(current.revision + 1);
  } finally {
    release.open();
    await flushed;
  }
  expect((await s.store.sessionReadMetadata(sessionId))?.revision).toBe(current.revision + 1);
});

it("rejects a stale authority generation on the read path", async () => {
  const { s, sessionId } = await hostedSession();
  await s.store.flushAll();
  await s.store.db
    .prepare("INSERT INTO host_authority_heads VALUES (?, ?, ?, ?, ?)")
    .run(s.store.environmentId, sessionId, 2, "scope-test", "host-active");
  await expect(s.store.assertAuthorityRead(sessionId, 1)).rejects.toBeInstanceOf(
    HostAuthorityFenceError,
  );
  await expect(s.store.assertAuthorityRead(sessionId, 2)).resolves.toBe(true);
});
