import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  readFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lstat, readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { runGitText } from "../src/shared/lib/processExecution.node";
import type { HostTask } from "../src/features/tasks/model/hostTasks";
import { HostTasks } from "./tasks";

vi.mock("../src/shared/lib/processExecution.node", async (original) => ({
  ...(await original<typeof import("../src/shared/lib/processExecution.node")>()),
  runGitText: vi.fn(),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat), readFile: vi.fn(actual.readFile) };
});

type FingerprintHost = { store: { project(id: string): { cwd: string } } };
const fingerprint = (
  HostTasks.prototype as unknown as {
    workspaceFingerprint(this: FingerprintHost, task: HostTask): Promise<string | undefined>;
  }
).workspaceFingerprint;
const task = { projectId: "fixture" } as HostTask;
const git = async (_cwd: string, args: string[]) => (await runGitText(args, { cwd: _cwd })).trim();

// Frozen pre-refactor algorithm: independent byte-for-byte compatibility oracle.
async function legacyFingerprint(
  this: FingerprintHost,
  task: HostTask,
): Promise<string | undefined> {
  const cwd = task.worktreeCwd ?? this.store.project(task.projectId).cwd;
  const hash = createHash("sha256");
  try {
    const tree = await git(cwd, ["rev-parse", "HEAD^{tree}"]);
    hash.update(tree).update(await git(cwd, ["diff", "--binary", "HEAD"]));
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
    let bytes = 0;
    for (const name of untracked.split(/\r?\n/).filter(Boolean).sort()) {
      const path = join(cwd, name);
      const info = lstatSync(path);
      if (!info.isFile() || (bytes += info.size) > 16 * 1024 * 1024) return undefined;
      hash.update(name).update(readFileSync(path));
    }
    return hash.digest("hex");
  } catch {
    // A non-Git project may be a small report/artifact folder. Keep this
    // fallback bounded so large projects cannot stall the scheduler.
    const pending = [""];
    let files = 0;
    let bytes = 0;
    try {
      while (pending.length) {
        const directory = pending.pop()!;
        const names = readdirSync(join(cwd, directory)).sort();
        for (const name of names) {
          if ([".git", "node_modules", "temp"].includes(name)) continue;
          if (++files > 2000) return undefined;
          const relative = join(directory, name);
          const path = join(cwd, relative);
          const info = lstatSync(path);
          if (info.isSymbolicLink()) continue;
          if (info.isDirectory()) pending.push(relative);
          else if (info.isFile()) {
            if ((bytes += info.size) > 16 * 1024 * 1024) return undefined;
            hash.update(relative).update(readFileSync(path));
          }
        }
      }
      return hash.digest("hex");
    } catch {
      return undefined;
    }
  }
}

let cwd: string;
let host: FingerprintHost;
beforeEach(async () => {
  const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  vi.mocked(lstat).mockImplementation(actual.lstat);
  vi.mocked(readFile).mockImplementation(actual.readFile);
  cwd = mkdtempSync(join(tmpdir(), "bycoda-fingerprint-"));
  host = { store: { project: () => ({ cwd }) } };
  vi.mocked(runGitText).mockRejectedValue(new Error("Not a Git repository"));
});
afterEach(() => {
  vi.clearAllMocks();
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
});
function gitFixture(names: string[]) {
  vi.mocked(runGitText).mockImplementation(async (args) => {
    if (args[0] === "rev-parse") return "tree\n";
    if (args[0] === "diff") return "binary diff\n";
    return names.join("\r\n");
  });
}
async function matchesLegacy() {
  const expected = await legacyFingerprint.call(host, task);
  expect(await fingerprint.call(host, task)).toBe(expected);
  return expected;
}

describe("workspace fingerprint asynchronous I/O", () => {
  it("limits concurrent reads and metadata calls to eight while allowing overlap", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const active = { reads: 0, stats: 0 };
    const peak = { reads: 0, stats: 0 };
    vi.mocked(readFile).mockImplementation(async (path) => {
      peak.reads = Math.max(peak.reads, ++active.reads);
      try {
        await delay(2);
        return await actual.readFile(path);
      } finally {
        active.reads--;
      }
    });
    vi.mocked(lstat).mockImplementation(async (path) => {
      peak.stats = Math.max(peak.stats, ++active.stats);
      try {
        await delay(2);
        return await actual.lstat(path);
      } finally {
        active.stats--;
      }
    });
    for (let i = 0; i < 33; i++) writeFileSync(join(cwd, "file-" + i), "content");
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
    expect(peak).toEqual({ reads: 8, stats: 8 });
    expect(active).toEqual({ reads: 0, stats: 0 });
  });

  it("does not read past the cumulative byte budget", async () => {
    writeFileSync(join(cwd, "a"), Buffer.alloc(8 * 1024 * 1024));
    writeFileSync(join(cwd, "b"), Buffer.alloc(8 * 1024 * 1024 + 1));
    writeFileSync(join(cwd, "c"), "later");
    expect(await fingerprint.call(host, task)).toBeUndefined();
    expect(vi.mocked(readFile).mock.calls.map(([path]) => path)).toEqual([join(cwd, "a")]);
  });

  it("drains failed Git read batches before starting fallback I/O", async () => {
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const names = Array.from({ length: 17 }, (_, i) => "file-" + String(i).padStart(2, "0"));
    for (const name of names) writeFileSync(join(cwd, name), "content");
    gitFixture(names);
    let active = 0;
    let peak = 0;
    let failed = false;
    vi.mocked(readFile).mockImplementation(async (path) => {
      peak = Math.max(peak, ++active);
      try {
        if (!failed) {
          failed = true;
          throw new Error("Transient read failure");
        }
        await delay(5);
        return await actual.readFile(path);
      } finally {
        active--;
      }
    });
    const expected = createHash("sha256").update("tree").update("binary diff").update(names[0]);
    for (const name of names) expected.update(name).update("content");
    expect(await fingerprint.call(host, task)).toBe(expected.digest("hex"));
    expect(peak).toBe(8);
    expect(active).toBe(0);
  });

  it("counts links in fallback but keeps the entry cap out of the Git path", async () => {
    const names = Array.from({ length: 1999 }, (_, i) => "file-" + i);
    for (const name of names) writeFileSync(join(cwd, name), "");
    symlinkSync(cwd, join(cwd, "z-cycle"), process.platform === "win32" ? "junction" : "dir");
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(cwd, "extra"), "");
    vi.mocked(lstat).mockClear();
    expect(await matchesLegacy()).toBeUndefined();
    expect(lstat).toHaveBeenCalledTimes(2000);
    writeFileSync(join(cwd, "another"), "");
    gitFixture([...names, "extra", "another"]);
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
  });

  it("retains the name prefix on a failed Git read before falling back", async () => {
    writeFileSync(join(cwd, "a"), "content");
    gitFixture(["a"]);
    vi.mocked(readFile).mockRejectedValueOnce(new Error("Transient read failure"));
    expect(await fingerprint.call(host, task)).toBe(
      createHash("sha256")
        .update("tree")
        .update("binary diff")
        .update("a")
        .update("a")
        .update("content")
        .digest("hex"),
    );
  });

  it("preserves sorted names and reverse-stack directory traversal", async () => {
    for (const name of ["z", "a"]) {
      mkdirSync(join(cwd, name));
      writeFileSync(join(cwd, name, "child"), name);
    }
    writeFileSync(join(cwd, "root"), "root");
    const expected = createHash("sha256")
      .update("root")
      .update("root")
      .update(join("z", "child"))
      .update("z")
      .update(join("a", "child"))
      .update("a")
      .digest("hex");
    expect(await matchesLegacy()).toBe(expected);
    expect(await fingerprint.call(host, task)).toBe(expected);
  });

  it("preserves Git tree, trimmed diff, sorted untracked names and binary bytes", async () => {
    const names = Array.from({ length: 25 }, (_, i) => "file-" + i);
    for (const name of names) writeFileSync(join(cwd, name), Buffer.from([0, 255, 13, 10]));
    gitFixture(names.reverse());
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(cwd, "file-1"), "changed");
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each([false, true])("keeps the exact cumulative 16 MiB boundary (Git=%s)", async (isGit) => {
    writeFileSync(join(cwd, "a"), Buffer.alloc(8 * 1024 * 1024, 1));
    writeFileSync(join(cwd, "b"), Buffer.alloc(8 * 1024 * 1024, 2));
    if (isGit) gitFixture(["b", "a"]);
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(cwd, "b"), Buffer.alloc(8 * 1024 * 1024 + 1));
    expect(await matchesLegacy()).toBeUndefined();
  });

  it("counts directories toward the 2,000 entry boundary and skips excluded trees", async () => {
    for (let i = 0; i < 1999; i++) writeFileSync(join(cwd, "file-" + i), "");
    mkdirSync(join(cwd, "dir"));
    for (const name of [".git", "node_modules", "temp"]) {
      mkdirSync(join(cwd, name));
      writeFileSync(join(cwd, name, "large"), Buffer.alloc(16 * 1024 * 1024 + 1));
    }
    expect(await matchesLegacy()).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(join(cwd, "dir", "overflow"), "");
    expect(await matchesLegacy()).toBeUndefined();
  });

  it("skips directory links without following cycles but rejects untracked links in Git", async () => {
    writeFileSync(join(cwd, "a"), "content");
    symlinkSync(cwd, join(cwd, "cycle"), process.platform === "win32" ? "junction" : "dir");
    expect(await matchesLegacy()).toBe(
      createHash("sha256").update("a").update("content").digest("hex"),
    );
    gitFixture(["a", "cycle"]);
    expect(await matchesLegacy()).toBeUndefined();
  });

  it("retains the already-hashed Git prefix when a later stat fails and fallback runs", async () => {
    writeFileSync(join(cwd, "a"), "content");
    gitFixture(["a", "missing"]);
    expect(await matchesLegacy()).toBe(
      createHash("sha256")
        .update("tree")
        .update("binary diff")
        .update("a")
        .update("content")
        .update("a")
        .update("content")
        .digest("hex"),
    );
  });

  it("hashes an empty folder and returns undefined for an unavailable folder", async () => {
    expect(await matchesLegacy()).toBe(createHash("sha256").digest("hex"));
    const missing = { store: { project: () => ({ cwd: join(cwd, "missing") }) } };
    expect(await fingerprint.call(missing, task)).toBeUndefined();
  });
});
