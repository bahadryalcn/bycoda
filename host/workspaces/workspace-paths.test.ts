import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import {
  canonicalWorkspaceDirectory,
  canonicalWorkspaceDirectorySync,
  canonicalWorkspaceEntry,
  canonicalWorkspacePath,
  canonicalWorkspacePathSync,
  workspacePathKey,
} from "./workspace-paths";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

it("resolves linked ancestors for existing and missing workspace entries without following an endpoint link", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-paths-"));
  temporary.push(root);
  const actual = join(root, "actual");
  const alias = join(root, "alias");
  await mkdir(join(actual, "managed", "workspace"), { recursive: true });
  await symlink(actual, alias, process.platform === "win32" ? "junction" : "dir");
  const canonical = await canonicalWorkspacePath(actual);
  const existing = join(alias, "managed", "workspace");
  const missing = join(alias, "managed", "new", "workspace");
  expect(await canonicalWorkspaceEntry(existing)).toBe(join(canonical, "managed", "workspace"));
  expect(await canonicalWorkspaceDirectory(missing)).toBe(
    join(canonical, "managed", "new", "workspace"),
  );
  expect(canonicalWorkspaceDirectorySync(missing)).toBe(await canonicalWorkspaceDirectory(missing));
  const endpoint = join(alias, "managed", "linked-workspace");
  await writeFile(join(actual, "sentinel.txt"), "preserve target");
  await symlink(actual, endpoint, process.platform === "win32" ? "junction" : "dir");
  await expect(canonicalWorkspaceEntry(endpoint)).rejects.toThrow("symbolic link or reparse point");
  await expect(canonicalWorkspaceEntry(alias)).rejects.toThrow("symbolic link or reparse point");
  expect(canonicalWorkspacePathSync(existing)).toBe(await canonicalWorkspacePath(existing));
});

it.runIf(process.platform === "win32")(
  "returns ordinary Windows paths for Git and UI consumers",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "bycoda-paths-"));
    temporary.push(root);
    const prefixed = `\\\\?\\${root}`;
    const canonical = await canonicalWorkspacePath(prefixed);
    expect(canonical.startsWith("\\\\?\\")).toBe(false);
    expect(canonicalWorkspacePathSync(prefixed)).toBe(canonical);
    expect(workspacePathKey(prefixed)).toBe(workspacePathKey(root));
    const slashed = prefixed.replaceAll("\\", "/");
    expect(await canonicalWorkspacePath(slashed)).toBe(canonical);
    expect(canonicalWorkspacePathSync(slashed)).toBe(canonical);
    expect(workspacePathKey(slashed)).toBe(workspacePathKey(root));
  },
);
