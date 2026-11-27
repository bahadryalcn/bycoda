import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hostGitExec } from "./git-exec-pool";
import {
  execFilesOffThread,
  nestedRepositoryCandidates,
  readWindowsRepositoryScan,
} from "./git-repository-discovery";

it.skipIf(process.platform !== "win32")(
  "keeps actionable PowerShell stderr within the client log budget",
  async () => {
    const script = [
      "[Console]::Error.WriteLine('At line:1 char:1')",
      "[Console]::Error.WriteLine('+ PRIVATE_SCRIPT_TEXT')",
      "[Console]::Error.WriteLine('Command failed: powershell -Command PRIVATE_ARGV')",
      "[Console]::Error.WriteLine('Access to directory denied')",
      "[Console]::Error.WriteLine(('x' * 700))",
      "exit 1",
    ].join("\n");
    const [scan] = await execFilesOffThread(
      [{ file: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command", script] }],
      10_000,
    );

    expect(scan).toMatchObject({
      failure: { phase: "exit", exitCode: 1, spawnCode: null, signal: null },
    });
    if (!("failure" in scan)) throw new Error("Expected a PowerShell failure");
    expect(scan.failure.stderr).toHaveLength(500);
    expect(scan.failure.stderr).not.toMatch(/PRIVATE_|At line:/);
    expect(() => readWindowsRepositoryScan(scan)).toThrow(
      expect.objectContaining({
        message: "Repository discovery failed (powershell exit 1): Access to directory denied",
        cause: scan.failure,
      }),
    );
    try {
      readWindowsRepositoryScan(scan);
    } catch (error) {
      expect((error as Error).message.slice(0, 298)).toContain("Access to directory denied");
    }
  },
);

it("distinguishes command spawn and output-limit failures", async () => {
  const { root } = fixture();
  const results = await execFilesOffThread(
    [
      { file: join(root, "missing-command"), args: [] },
      { file: process.execPath, args: ["-e", "process.stdout.write('x'.repeat(1024))"] },
    ],
    10_000,
    128,
  );
  expect(results).toMatchObject([
    { failure: { phase: "spawn", spawnCode: "ENOENT", exitCode: null } },
    { failure: { phase: "output-limit", spawnCode: null, exitCode: null } },
  ]);
});

it("reports a command that expires in the pool queue as a discovery timeout", async () => {
  const exec = vi.spyOn(hostGitExec, "exec").mockRejectedValueOnce(
    Object.assign(new Error("Command timed out before launch"), {
      code: "ETIMEDOUT",
      killed: false,
      signal: null,
      stderr: "",
    }),
  );
  try {
    const [scan] = await execFilesOffThread([{ file: "powershell.exe", args: [] }], 10_000);
    expect(() => readWindowsRepositoryScan(scan)).toThrow(
      expect.objectContaining({
        message: "Repository discovery timed out (powershell timeout)",
        cause: { phase: "timeout", exitCode: null, spawnCode: null, signal: null, stderr: "" },
      }),
    );
  } finally {
    exec.mockRestore();
  }
});

it("keeps a timeout distinct from an incomplete scan", () => {
  const failure = {
    phase: "timeout",
    exitCode: null,
    spawnCode: null,
    signal: "SIGTERM",
    stderr: "",
  } as const;
  expect(() => readWindowsRepositoryScan({ failure })).toThrow(
    expect.objectContaining({
      message: "Repository discovery timed out (powershell timeout SIGTERM)",
      cause: failure,
    }),
  );
});

it.each([
  [" \r\n\t", "Repository discovery returned no output"],
  ['{"repositories":', "Repository discovery returned malformed JSON"],
  ['{"repositories":[false]}', "Repository discovery returned invalid paths"],
])("reports invalid PowerShell output %j as a protocol error", (stdout, message) => {
  expect(() => readWindowsRepositoryScan({ stdout })).toThrow(
    expect.objectContaining({
      message,
      cause: expect.objectContaining({ phase: "parse", exitCode: 0 }),
    }),
  );
});

it("accepts a complete scan that found no repositories", () => {
  expect(readWindowsRepositoryScan({ stdout: '{"repositories":[],"limit":null}\r\n' })).toEqual({
    repositories: [],
    limit: null,
  });
});

const roots: string[] = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fixture = () => {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "bycoda-repository-scan-")));
  roots.push(base);
  const root = join(base, "root");
  const outside = join(base, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(outside, "sentinel"), "outside data");
  return { base, root, outside };
};

it("rejects a trusted root replaced with a link before enumeration", async () => {
  const f = fixture();
  renameSync(f.root, join(f.base, "previous-root"));
  symlinkSync(f.outside, f.root, process.platform === "win32" ? "junction" : "dir");
  await expect(nestedRepositoryCandidates(f.root, () => 10_000)).rejects.toThrow(
    "Repository discovery directory changed",
  );
  expect(readFileSync(join(f.outside, "sentinel"), "utf8")).toBe("outside data");
});

it("revalidates a queued directory before the Node enumerator opens it", async () => {
  const f = fixture();
  const queued = join(f.root, "queued");
  mkdirSync(queued);
  const linkType = process.platform === "win32" ? "junction" : "dir";
  // Exercise the Node fallback with the real filesystem even on Windows.
  const nodeProcess = Object.create(process);
  Object.defineProperty(nodeProcess, "platform", { value: "linux" });
  vi.stubGlobal("process", nodeProcess);
  let reads = 0;
  const remaining = () => {
    if (++reads === 3) {
      renameSync(queued, join(f.base, "previous-child"));
      symlinkSync(f.outside, queued, linkType);
    }
    return 10_000;
  };
  await expect(nestedRepositoryCandidates(f.root, remaining)).rejects.toThrow(
    "Repository discovery directory changed",
  );
  expect(readFileSync(join(f.outside, "sentinel"), "utf8")).toBe("outside data");
});

const repository = (root: string, ...parts: string[]) => {
  const path = join(root, ...parts);
  mkdirSync(join(path, ".git"), { recursive: true });
  return path;
};

// The default scan uses PowerShell on Windows; the Node fallback is exercised on every platform.
const scanners = [
  ["platform scanner", false],
  ["Node fallback", true],
] as const;

describe.each(scanners)("size limits with the %s", (_name, fallback) => {
  const scan = (root: string, limits: Parameters<typeof nestedRepositoryCandidates>[2]) => {
    if (fallback) {
      const nodeProcess = Object.create(process);
      Object.defineProperty(nodeProcess, "platform", { value: "linux" });
      vi.stubGlobal("process", nodeProcess);
    }
    return nestedRepositoryCandidates(root, () => 10_000, limits);
  };

  it("reports a complete scan without a limit", async () => {
    const f = fixture();
    const found = [repository(f.root, "a"), repository(f.root, "b", "c")];
    const result = await scan(f.root, {});
    expect(result.limit).toBeNull();
    expect([...result.repositories].sort()).toEqual(found.sort());
  });

  it("keeps the repositories found before the repository limit", async () => {
    const f = fixture();
    const all = ["a", "b", "c"].map((name) => repository(f.root, name));
    const result = await scan(f.root, { repositories: 2 });
    expect(result.limit).toBe("repositories");
    expect(result.repositories).toHaveLength(2);
    for (const path of result.repositories) expect(all).toContain(path);
  });

  it("keeps the repositories found before the entry limit", async () => {
    const f = fixture();
    const all = ["a", "b", "c"].map((name) => repository(f.root, name));
    const result = await scan(f.root, { entries: 2 });
    expect(result.limit).toBe("entries");
    expect(result.repositories).toHaveLength(2);
    for (const path of result.repositories) expect(all).toContain(path);
  });

  it("keeps the repositories found before the directory limit", async () => {
    const f = fixture();
    const all = ["a", "b", "c"].map((name) => repository(f.root, name));
    const result = await scan(f.root, { directories: 2 });
    expect(result.limit).toBe("directories");
    expect([...result.repositories].sort()).toEqual(all.sort());
  });

  it("skips directories below the depth limit and keeps scanning their siblings", async () => {
    const f = fixture();
    const shallow = repository(f.root, "a");
    repository(f.root, "b", "deep");
    const result = await scan(f.root, { depth: 1 });
    expect(result).toEqual({ repositories: [shallow], limit: "depth" });
  });

  it("still fails when a deadline passes, because the rest of the tree is unknown", async () => {
    const f = fixture();
    repository(f.root, "a");
    await expect(nestedRepositoryCandidates(f.root, () => 0)).rejects.toThrow(
      "Repository discovery timed out",
    );
  });
});
