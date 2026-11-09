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
import { afterEach, expect, it, vi } from "vitest";
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
