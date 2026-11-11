import { afterEach, expect, it } from "vitest";
import { lstat, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileAsync } from "../../src/shared/lib/processExecution.node";
import { initializeEmptyProjectRepository } from "./git-init";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("initializes only an empty folder outside every work tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "bycoda-git-init-"));
  roots.push(root);
  const inside = (cwd: string) =>
    execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd, windowsHide: true }).then(
      () => true,
      () => false,
    );
  // A repository above the temporary folder would own every folder below it.
  if (await inside(root)) return;
  const filled = join(root, "filled");
  await mkdir(filled);
  await writeFile(join(filled, "notes.txt"), "existing");
  await initializeEmptyProjectRepository(filled);
  expect(await inside(filled)).toBe(false);
  const fresh = join(root, "fresh");
  await mkdir(fresh);
  await initializeEmptyProjectRepository(fresh);
  expect(await inside(fresh)).toBe(true);
  const nested = join(fresh, "nested");
  await mkdir(nested);
  await initializeEmptyProjectRepository(nested);
  await expect(lstat(join(nested, ".git"))).rejects.toThrow();
});
