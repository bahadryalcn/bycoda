import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HostCheckpoints } from "./checkpoints";
import { SessionFileRevert } from "./session-file-revert";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function fixture(paths = ["a.txt"]) {
  const root = await mkdtemp(join(tmpdir(), "bycoda-files-authority-"));
  cleanups.push(async () => {
    const target = resolve(root);
    if (
      resolve(join(target, "..")) !== resolve(tmpdir()) ||
      !basename(target).startsWith("bycoda-files-authority-")
    )
      throw new Error("refusing unexpected fixture directory");
    await rm(target, { recursive: true, force: true });
  });
  await mkdir(join(root, "checkout"));
  const cwd = await realpath(join(root, "checkout"));
  const store = new HostStore(join(root, "host.db"));
  cleanups.push(() => store.close().catch(() => undefined));
  await store.ready;
  await store.addProject(cwd, "Fixture");
  await store.db
    .prepare("INSERT INTO host_authority_heads VALUES(?,?,?,?,?)")
    .run(store.environmentId, "session", 2, "synthetic-floor-fixture", "host-active");
  const authority = vi.fn(async (id: string, generation?: number) => {
    await store.assertAuthority(id, generation);
  });
  const checkpoints = new HostCheckpoints(join(root, "checkpoints"), undefined, authority);
  for (const path of paths) await writeFile(join(cwd, path), "before\n");
  await checkpoints.beginFilesTurn("session", cwd, "run", "message");
  for (const path of paths) await writeFile(join(cwd, path), "after\n");
  await checkpoints.finishFilesTurn("session", cwd, "run");
  const floor = async (generation: number) => {
    await store.db
      .prepare("UPDATE host_authority_heads SET generation=? WHERE session_id=?")
      .run(generation, "session");
  };
  return {
    root,
    cwd,
    store,
    authority,
    checkpoints,
    floor,
    read: (path = "a.txt") => readFile(join(cwd, path), "utf8"),
    plan: (generation = 2) => checkpoints.filesRevertPlan("session", cwd, "message", generation),
  };
}

it("requires an injected durable guard for direct file planning/revert and aggregate Undo", async () => {
  const f = await fixture();
  const missing = new HostCheckpoints(join(f.root, "checkpoints"));
  await expect(missing.filesRevertPlan("session", f.cwd, "message")).rejects.toThrow(
    "durable authority guard",
  );
  await expect(missing.filesRevert("session", f.cwd, "message")).rejects.toThrow(
    "durable authority guard",
  );
  await expect(missing.change("session", f.cwd, undefined, true)).rejects.toThrow(
    "durable authority guard",
  );
  const raw = new SessionFileRevert(join(f.root, "checkpoints"));
  await expect(raw.revert("session", f.cwd, "message")).rejects.toThrow("durable authority guard");
  expect(await f.read()).toBe("after\n");
});

it("binds migrated preview token to exact history and generation, then restores only that reviewed selection", async () => {
  const f = await fixture();
  const plan = await f.plan();
  expect(plan.authorityGeneration).toBe(2);
  expect(plan.planToken).toMatch(/^[a-f0-9]{64}$/);
  await expect(
    f.checkpoints.filesRevert("session", f.cwd, "message", undefined, 2),
  ).rejects.toThrow("preview changed");
  await expect(
    f.checkpoints.filesRevert("session", f.cwd, "message", "wrong-token", 2),
  ).rejects.toThrow("preview changed");
  expect(await f.read()).toBe("after\n");
  expect(
    (await f.checkpoints.filesRevert("session", f.cwd, "message", plan.planToken, 2)).reverted,
  ).toEqual(["a.txt"]);
  expect(await f.read()).toBe("before\n");
});

it("rejects old/missing generation after confirmation and requires an explicit fresh preview", async () => {
  const f = await fixture();
  const old = await f.plan();
  await f.floor(3);
  for (const generation of [undefined, 1, 2])
    await expect(
      f.checkpoints.filesRevert("session", f.cwd, "message", old.planToken, generation),
    ).rejects.toThrow("current generation");
  await expect(
    f.checkpoints.filesRevert("session", f.cwd, "message", old.planToken, 3),
  ).rejects.toThrow("preview changed");
  expect(await f.read()).toBe("after\n");
  const fresh = await f.plan(3);
  expect(fresh.planToken).not.toBe(old.planToken);
  expect(
    (await f.checkpoints.filesRevert("session", f.cwd, "message", fresh.planToken, 3)).reverted,
  ).toEqual(["a.txt"]);
});

it.each(["file-revert", "checkpoint-undo"] as const)(
  "rechecks %s inside its actual waited operation mutex",
  async (operation) => {
    const f = await fixture();
    const plan = await f.plan();
    const checkpoint = await f.checkpoints.status("session", f.cwd, 2);
    const entered = deferred(),
      release = deferred();
    const queue = f.checkpoints as unknown as {
      queue<T>(id: string, paths: string[], work: () => Promise<T>): Promise<T>;
    };
    const held = queue.queue("session", [f.cwd], async () => {
      entered.resolve();
      await release.promise;
    });
    await entered.promise;
    const pending =
      operation === "file-revert"
        ? f.checkpoints.filesRevert("session", f.cwd, "message", plan.planToken, 2)
        : f.checkpoints.change("session", f.cwd, undefined, true, checkpoint.expectedCheckpoint, 2);
    const rejection = expect(pending).rejects.toThrow("current generation");
    await f.floor(3);
    release.resolve();
    await held;
    await rejection;
    expect(await f.read()).toBe("after\n");
  },
);

it("rolls back its captured original directory entry if authority changes before replacement", async () => {
  const f = await fixture();
  const plan = await f.plan();
  let advanced = false;
  f.authority.mockImplementation(async (id, generation) => {
    if (!advanced && (await readdir(f.cwd)).some((path) => path.startsWith(".bycoda-rescue-"))) {
      advanced = true;
      await f.floor(3);
    }
    await f.store.assertAuthority(id, generation);
  });
  await expect(
    f.checkpoints.filesRevert("session", f.cwd, "message", plan.planToken, 2),
  ).rejects.toThrow("current generation");
  expect(advanced).toBe(true);
  expect(await f.read()).toBe("after\n");
  expect((await readdir(f.cwd)).filter((path) => path.startsWith(".bycoda-"))).toEqual([]);
  expect((await f.plan(3)).files.map((file) => file.path)).toEqual(["a.txt"]);
});

it("records an earlier committed file while blocking remaining effects after authority loss", async () => {
  const f = await fixture(["a.txt", "b.txt"]);
  const plan = await f.plan();
  let advanced = false;
  f.authority.mockImplementation(async (id, generation) => {
    if (!advanced && (await f.read("a.txt").catch(() => undefined)) === "before\n") {
      advanced = true;
      await f.floor(3);
    }
    await f.store.assertAuthority(id, generation);
  });
  const operation = f.checkpoints.filesRevert("session", f.cwd, "message", plan.planToken, 2);
  await expect(operation).rejects.toThrow('already reverted 1 file(s): ["a.txt"]');
  await expect(operation).rejects.toMatchObject({
    partialResult: { reverted: ["a.txt"], skipped: [expect.objectContaining({ path: "b.txt" })] },
  });
  expect(await f.read("a.txt")).toBe("before\n");
  expect(await f.read("b.txt")).toBe("after\n");
  expect((await f.plan(3)).files.map((file) => file.path)).toEqual(["b.txt"]);
  expect(
    (await f.checkpoints.status("session", f.cwd, 3)).files.map((file) => file.relative),
  ).toEqual(["b.txt"]);
});

it.each([false, true])(
  "binds checkpoint Keep/Undo=%s to retained generation and review fingerprint",
  async (undo) => {
    const f = await fixture();
    const old = await f.checkpoints.status("session", f.cwd, 2);
    const legacy = await f.checkpoints.status("session", f.cwd);
    expect(old.expectedCheckpoint).not.toBe(legacy.expectedCheckpoint);
    await f.floor(3);
    await expect(
      f.checkpoints.change("session", f.cwd, undefined, undo, old.expectedCheckpoint, 2),
    ).rejects.toThrow("current generation");
    await expect(
      f.checkpoints.change("session", f.cwd, undefined, undo, old.expectedCheckpoint, 3),
    ).rejects.toThrow("checkpoint changed");
    await expect(
      f.checkpoints.change("session", f.cwd, undefined, undo, undefined, 3),
    ).rejects.toThrow("checkpoint changed");
    const fresh = await f.checkpoints.status("session", f.cwd, 3);
    expect(
      (await f.checkpoints.change("session", f.cwd, undefined, undo, fresh.expectedCheckpoint, 3))
        .files,
    ).toEqual([]);
    expect(await f.read()).toBe(undo ? "before\n" : "after\n");
  },
);

it("forwards strict checkpoint command input metadata without reading a new floor into the intent", async () => {
  const f = await fixture();
  const commands = new WorkspaceCommands(f.store, async (_id, work) => work(), f.checkpoints);
  const reviewed = (await commands.run("session_checkpoint_status", {
    cwd: f.cwd,
    sessionId: "session",
    authorityGeneration: 2,
  })) as { expectedCheckpoint: string };
  await f.floor(3);
  await expect(
    commands.run("session_checkpoint_undo", {
      cwd: f.cwd,
      sessionId: "session",
      authorityGeneration: 2,
      expectedCheckpoint: reviewed.expectedCheckpoint,
    }),
  ).rejects.toThrow("current generation");
  await expect(
    commands.run("session_checkpoint_keep", {
      cwd: f.cwd,
      sessionId: "session",
      authorityGeneration: "3",
      expectedCheckpoint: reviewed.expectedCheckpoint,
    }),
  ).rejects.toThrow("Invalid file revert authority");
  expect(await f.read()).toBe("after\n");
});
