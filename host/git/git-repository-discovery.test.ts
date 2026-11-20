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
import { nestedRepositoryCandidates } from "./git-repository-discovery";

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
