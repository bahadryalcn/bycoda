import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { createSessionListRuntime } from "./session-list";

// Each built list weighs 6 MiB, so a third list pushes the 16 MiB budget over.
vi.mock("../../src/features/connections/model/snapshotWeight", () => ({
  snapshotWeight: () => 6 * 1024 * 1024,
}));

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-list-lru-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const [a, b, c] = [
    (await store.addProject("/lru-a", "A")).id,
    (await store.addProject("/lru-b", "B")).id,
    (await store.addProject("/lru-c", "C")).id,
  ];
  const fingerprints = new Map<string, string>();
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: {
        listSnapshotAsync: async (_cwd: string, projectId: string) => ({
          sessions: [],
          fingerprint: fingerprints.get(projectId) ?? "fixed",
        }),
        samePath: (x: string, y: string) => x === y,
      },
      desktopWatch: async () => false,
      catchUp: async () => undefined,
      tasks: { changeEtag: async () => "tasks" },
      providers: [],
      pullRequestWatch: { wakeSources: () => new Map() },
    } as never,
    (value) => {
      runtime = value;
    },
  );
  return { store, runtime, a, b, c, fingerprints };
}

/** The project polled on every request must outlive projects nobody reads. */
it("keeps a project served from cache when the byte budget evicts", async () => {
  const { store, runtime, a, b, c } = await setup();
  await runtime.projectSessionList(a);
  await runtime.projectSessionList(b);
  const summaries = vi.spyOn(store, "summaries");
  await runtime.projectSessionList(a);
  // A hit rebuilds nothing; it only makes A the most recently used entry.
  expect(summaries).not.toHaveBeenCalled();
  await runtime.projectSessionList(c);
  expect([...runtime.projectChangeCache.keys()]).toEqual([a, c]);
});

/** A project rebuilt because an input moved is as recent as one served from cache. */
it("moves a rebuilt project to the newest position before evicting", async () => {
  const { runtime, a, b, c, fingerprints } = await setup();
  await runtime.projectSessionList(a);
  await runtime.projectSessionList(b);
  fingerprints.set(a, "moved");
  await runtime.projectSessionList(a);
  await runtime.projectSessionList(c);
  expect([...runtime.projectChangeCache.keys()]).toEqual([a, c]);
});

/** Reordering must not weaken invalidation: a changed input still rebuilds the list. */
it("still rebuilds a cached project when its inputs change", async () => {
  const { store, runtime, a, fingerprints } = await setup();
  await runtime.projectSessionList(a);
  const summaries = vi.spyOn(store, "summaries");
  await runtime.projectSessionList(a);
  expect(summaries).not.toHaveBeenCalled();
  fingerprints.set(a, "moved");
  await runtime.projectSessionList(a);
  expect(summaries).toHaveBeenCalledTimes(1);
});
