import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { walkPosixWorkspaceLinks } from "./workspace-cleanup-paths";

const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

// Junctions report as symbolic links through lstat/Dirent on Windows, so the
// non-Windows walker's no-follow behavior is exercised on every platform.
const linkType = process.platform === "win32" ? "junction" : "dir";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-cleanup-links-"));
  temporary.push(root);
  const outside = join(root, "outside");
  const workspace = join(root, "workspace");
  await mkdir(join(outside, "deep"), { recursive: true });
  await writeFile(join(outside, "deep", "secret.txt"), "x");
  await symlink(join(outside, "deep"), join(outside, "loop"), linkType);
  const store = join(workspace, "node_modules", ".pnpm", "pkg", "node_modules");
  await mkdir(store, { recursive: true });
  for (let index = 0; index < 40; index++) {
    const directory = join(workspace, "src", `d${index}`, "nested");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "file.ts"), "x");
  }
  await symlink(outside, join(workspace, "node_modules", "pkg"), linkType);
  await symlink(outside, join(store, "dep"), linkType);
  await symlink(outside, join(workspace, "src", "d7", "escape"), linkType);
  return { workspace, outside };
}

it("inventories links asynchronously without following them or blocking the event loop", async () => {
  const { workspace } = await fixture();
  let ticks = 0;
  const timer = setInterval(() => (ticks += 1), 0);
  let immediates = 0;
  const spin = () => {
    immediates += 1;
    if (!finished) setImmediate(spin);
  };
  let finished = false;
  setImmediate(spin);
  const links = await walkPosixWorkspaceLinks(workspace);
  finished = true;
  clearInterval(timer);

  expect(links).toEqual(
    [
      {
        path: join(workspace, "node_modules", ".pnpm", "pkg", "node_modules", "dep"),
        kind: "dependencySymlink",
      },
      { path: join(workspace, "node_modules", "pkg"), kind: "dependencySymlink" },
      { path: join(workspace, "src", "d7", "escape"), kind: "unsafe" },
    ].sort((a, b) => (a.path < b.path ? -1 : 1)),
  );
  // A synchronous walk would let no other callback run before it returns.
  expect(immediates).toBeGreaterThan(1);
  expect(ticks + immediates).toBeGreaterThan(2);
});

it("stops at the first link for remaining-link checks and reports clean trees as empty", async () => {
  const { workspace, outside } = await fixture();
  expect(await walkPosixWorkspaceLinks(workspace, { firstOnly: true })).toHaveLength(1);
  const clean = join(outside, "deep");
  expect(await walkPosixWorkspaceLinks(clean)).toEqual([]);
});

it("fails the inventory instead of skipping an unreadable directory", async () => {
  const { workspace } = await fixture();
  await expect(walkPosixWorkspaceLinks(join(workspace, "missing"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
