import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseHostDirectories } from "../../browser/browse";
import {
  cloneProgress,
  cloneRepository,
  inferCloneName,
  resolveCloneDestination,
  validateCloneName,
  validateCloneUrl,
} from "./clone";
import { createProjectsService } from "./service";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-clone-"));
  roots.push(root);
  return root;
}

it("accepts only network git URLs and never an option", () => {
  for (const ok of [
    "https://github.com/a/b.git",
    "http://host/a/b",
    "ssh://git@host/a/b.git",
    "git://host/a/b",
    "git@github.com:a/b.git",
  ])
    expect(validateCloneUrl(`  ${ok} `)).toBe(ok);
  for (const bad of [
    "",
    "--upload-pack=evil",
    "-c x=y",
    "file:///etc",
    "/local/path",
    "ext::sh -c id",
    "https://host/a b",
    "https://host/a\nb",
    `https://host/${"a".repeat(3000)}`,
  ])
    expect(() => validateCloneUrl(bad)).toThrow("Enter an https, ssh, or git URL");
});

it("infers the repository name and validates a custom name", () => {
  expect(inferCloneName("https://github.com/a/b.git")).toBe("b");
  expect(inferCloneName("git@github.com:a/tool/")).toBe("tool");
  expect(() => inferCloneName("https://host/..")).toThrow();
  for (const bad of ["", " x", "a/b", "a\\b", "..", "-rf", "con", "x."])
    expect(() => validateCloneName(bad)).toThrow("Invalid folder name");
  expect(validateCloneName("my-repo")).toBe("my-repo");
});

it("refuses an existing destination", async () => {
  const root = await temp();
  await mkdir(join(root, "taken"));
  await expect(resolveCloneDestination(root, "taken", exists)).rejects.toThrow("already exists");
  await expect(resolveCloneDestination(root, "fresh", exists)).resolves.toBe(join(root, "fresh"));
});

it("runs the clone with a validated destination and records progress", async () => {
  const root = await temp();
  const run = vi.fn(async () => {});
  const result = await cloneRepository(
    { url: "https://github.com/a/b.git", parentPath: root, operationId: "op1" },
    root,
    run,
    exists,
  );
  expect(result).toEqual({ path: join(root, "b") });
  expect(run).toHaveBeenCalledWith("https://github.com/a/b.git", join(root, "b"), {
    operationId: "op1",
  });
  expect(cloneProgress("op1")?.state).toBe("done");
  await expect(
    cloneRepository(
      { url: "https://h/a/c", parentPath: root, operationId: "op2" },
      root,
      async () => {
        throw new Error("boom");
      },
      exists,
    ),
  ).rejects.toThrow("boom");
  expect(cloneProgress("op2")?.state).toBe("failed");
});

it("service rejects a parent that is not an existing absolute directory", async () => {
  const service = createProjectsService({
    list: async () => [],
    directoryPorts: {
      browse: browseHostDirectories,
      directory: vi.fn(),
      createDirectory: vi.fn(),
      open: vi.fn(),
    },
  });
  const context = { authorized: vi.fn(async () => true) };
  await expect(
    service.clone({ url: "https://h/a/b", parentPath: "relative/dir" }, context),
  ).rejects.toThrow("absolute");
  await expect(
    service.clone(
      { url: "https://h/a/b", parentPath: join(tmpdir(), "bycoda-missing-xyz") },
      context,
    ),
  ).rejects.toThrow();
  await expect(service.clone({ url: "--evil", parentPath: tmpdir() }, context)).rejects.toThrow(
    "https, ssh, or git",
  );
});
