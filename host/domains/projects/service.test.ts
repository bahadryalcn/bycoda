import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browseHostDirectories, createHostDirectory } from "../../browser/browse";
import { HostDomainRefusalError } from "../context";
import { createProjectsService } from "./service";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-project-domain-"));
  roots.push(root);
  const context = { authorized: vi.fn(async () => true) };
  const project = { id: "project", cwd: root, name: "Fixture" };
  const directoryPorts = {
    directory: vi.fn(async () => ({
      version: 1 as const,
      privacyReady: false,
      projects: [],
      groups: [],
    })),
    browse: browseHostDirectories,
    createDirectory: createHostDirectory,
    open: vi.fn(async (_cwd: string, authorize: () => Promise<boolean>) => {
      await authorize();
      return project;
    }),
  };
  return {
    root,
    context,
    directoryPorts,
    service: createProjectsService({ list: async () => [project], directoryPorts }),
  };
}
it("preserves directory navigation and creates exactly one child without overwriting", async () => {
  const f = await fixture();
  await writeFile(join(f.root, "file.txt"), "not a directory");
  const created = await f.service.createDirectory({ path: f.root, name: "child" }, f.context);
  expect(created.path).toBe(join(f.root, "child"));
  expect(created.parent).toBe(f.root);
  expect((await f.service.browse({ path: f.root }, f.context)).entries).toEqual([
    { name: "child", path: created.path },
  ]);
  await expect(
    f.service.createDirectory({ path: f.root, name: "child" }, f.context),
  ).rejects.toThrow();
  for (const name of ["../escape", "a/b", "..", "NUL", "trailing."])
    await expect(f.service.createDirectory({ path: f.root, name }, f.context)).rejects.toThrow();
  await expect(f.service.browse({ path: "relative" }, f.context)).rejects.toThrow("absolute");
});
it("rechecks the real mkdir effect after asynchronous directory discovery", async () => {
  const f = await fixture();
  f.directoryPorts.createDirectory = (path, name, authorize) =>
    createHostDirectory(path, name, async () => {
      f.context.authorized.mockResolvedValue(false);
      await authorize?.();
    });
  await expect(
    f.service.createDirectory({ path: f.root, name: "denied" }, f.context),
  ).rejects.toThrow("revoked");
  await expect(stat(join(f.root, "denied"))).rejects.toThrow();
});
it("rechecks directory/list disclosure and grants at the injected open effect", async () => {
  const f = await fixture();
  expect(await f.service.directory({}, f.context)).toEqual({
    version: 1,
    privacyReady: false,
    projects: [],
    groups: [],
  });
  f.directoryPorts.directory.mockImplementation(async () => {
    f.context.authorized.mockResolvedValue(false);
    return { version: 1, privacyReady: false, projects: [], groups: [] };
  });
  await expect(f.service.directory({}, f.context)).rejects.toThrow("revoked");
  f.context.authorized.mockResolvedValue(true);
  f.directoryPorts.open.mockImplementation(async (_cwd, authorize) => {
    f.context.authorized.mockResolvedValue(false);
    await authorize();
    return { id: "no", cwd: "no", name: "no" };
  });
  await expect(f.service.open({ cwd: f.root }, f.context)).rejects.toThrow("revoked");
  const legacy = createProjectsService({ list: async () => ["retained"] });
  expect(await legacy.list()).toEqual(["retained"]);
  await expect(legacy.list({}, f.context)).rejects.toThrow("revoked");
});
it("refuses a missing folder as a known outcome and passes other failures through", async () => {
  const f = await fixture();
  const gone = join(f.root, "gone");
  f.directoryPorts.open.mockRejectedValueOnce(
    Object.assign(new Error(`ENOENT: no such file or directory, realpath '${gone}'`), {
      code: "ENOENT",
    }),
  );
  const error: unknown = await f.service.open({ cwd: gone }, f.context).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(HostDomainRefusalError);
  expect(error).toMatchObject({
    code: "PROJECT_FOLDER_MISSING",
    category: "validation",
    retryable: false,
    delivery: "not-sent",
    message: `Project folder not found on this machine: ${gone}`,
  });
  f.directoryPorts.open.mockRejectedValueOnce(new Error("database is locked"));
  await expect(f.service.open({ cwd: f.root }, f.context)).rejects.toThrow("database is locked");
});
it("keeps strict WS params and tolerant HTTP extension fields without retries", async () => {
  const f = await fixture();
  await expect(f.service.open({ cwd: f.root, extension: true }, f.context)).rejects.toThrow();
  expect(f.directoryPorts.open).not.toHaveBeenCalled();
  await f.service.open({ cwd: f.root, extension: true }, f.context, { legacy: true });
  expect(f.directoryPorts.open).toHaveBeenCalledTimes(1);
});
