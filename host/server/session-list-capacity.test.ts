import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "../store";
import { createSessionListRuntime } from "./session-list";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

/** A machine with over a hundred projects, read in turn by a polling phone. */
it("serves a second pass over many projects from cache with one project-table read per list", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-session-list-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(async () => {
    await store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const ids: string[] = [];
  for (let index = 0; index < 60; index++)
    ids.push((await store.addProject(`/capacity-${index}`, `P${index}`)).id);
  const listSnapshotAsync = vi.fn(async () => ({ sessions: [], fingerprint: "fixed" }));
  let runtime!: Awaited<ReturnType<typeof createSessionListRuntime>>;
  await createSessionListRuntime(
    {
      engine: { store },
      desktop: { listSnapshotAsync, samePath: (a: string, b: string) => a === b },
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
  for (const id of ids) await runtime.projectSessionList(id);
  const projects = vi.spyOn(store, "projects");
  const summaries = vi.spyOn(store, "summaries");
  const project = vi.spyOn(store, "project");
  for (const id of ids) await runtime.projectSessionList(id);
  // Warm pass: nothing is rebuilt, and each list reads the project table once.
  expect(summaries).not.toHaveBeenCalled();
  expect(projects).toHaveBeenCalledTimes(ids.length);
  expect(project).toHaveBeenCalledTimes(ids.length * 2);
}, 60_000);
