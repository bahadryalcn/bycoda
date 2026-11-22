import * as childProcess from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  NativeBufferClockBacking,
  NativeBufferClockState,
} from "../ports/native-buffer-persistence";
import type { ManagedWorkspace } from "../workspaces/workspace-contracts";
import { createNativeBufferGitPersistence } from "./native-buffer-git-persistence";
import { createNativeBufferReports } from "./native-buffer-reports";
import { hostGitExec } from "../git/git-exec-pool";

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
const poolExec = vi.spyOn(hostGitExec, "exec");

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const cleanups: string[] = [];
afterEach(async () => {
  for (const path of cleanups.splice(0))
    await rm(path, { recursive: true, force: true, maxRetries: 5 });
});
const gitSpawns = () =>
  vi.mocked(childProcess.spawn).mock.calls.filter(([command]) => command === "git").length +
  poolExec.mock.calls.filter(([command]) => command === "git").length;

function clocks(ids: string[]): NativeBufferClockBacking {
  const states = new Map<string, NativeBufferClockState>(
    ids.map((reportId) => [
      reportId,
      {
        version: 1,
        reportId,
        clockId: randomUUID(),
        base: 1,
        highWater: 1,
        digest: sha(reportId),
      },
    ]),
  );
  return {
    readClock: async (id) => states.get(id) ?? null,
    initializeClock: async (state) => state,
    advanceClock: async (_expected, next) => next,
  };
}

/** The Windows Host held its listen 11 s: 69 clocked legacy reports left on disk each cost
 * two git processes per directory scan, and probes then read each one through git again. */
async function fixture(count: number) {
  const root = await mkdtemp(join(tmpdir(), "nb-spawns-"));
  cleanups.push(root);
  const ids = Array.from({ length: count }, (_, index) => sha(`legacy-${index}`));
  const buffers = join(root, "managed-workspaces", "native-activity", "buffers");
  await mkdir(buffers, { recursive: true });
  for (const id of ids) await writeFile(join(buffers, `${id}.json`), "{}");
  const workspacePath = join(root, "workspace");
  await mkdir(workspacePath);
  const persistence = createNativeBufferGitPersistence({
    gitDir: join(root, "native-buffer-store.git"),
    clocks: clocks(ids),
  });
  // An existing snapshot, as on every Host that has retained buffer history.
  await persistence.complete({
    writes: [
      {
        key: "native-activity/buffer-history/chunks/seed.bin",
        bytes: Buffer.from("seed"),
        immutable: true,
      },
    ],
    certificates: [],
    authorize: async () => {},
  });
  const reports = createNativeBufferReports({
    root: join(root, "managed-workspaces"),
    listWorkspaces: async () => [{ id: "workspace", path: workspacePath } as ManagedWorkspace],
    serial: (action) => action(),
    authenticate: async () => "device",
    persistence,
  });
  return { reports };
}

it("initializes retention with a bounded number of git processes for any legacy report count", async () => {
  const count = 24;
  const { reports } = await fixture(count);
  const before = gitSpawns();
  await reports.initializeRetention();
  expect(gitSpawns() - before).toBeLessThanOrEqual(12);
});

it("probes clocked legacy reports with at most one git process per report", async () => {
  const count = 24;
  const { reports } = await fixture(count);
  await reports.initializeRetention();
  const before = gitSpawns();
  expect(await reports.probe("workspace")).toEqual([]);
  expect(gitSpawns() - before).toBeLessThanOrEqual(count + 8);
});
