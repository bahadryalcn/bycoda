import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, realpath, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceCommands } from "./workspace-commands";

const opening = vi.hoisted(() => ({ beforeOpen: undefined as (() => Promise<void>) | undefined }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...original,
    open: async (...args: Parameters<typeof original.open>) => {
      await opening.beforeOpen?.();
      return original.open(...args);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  opening.beforeOpen = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-transfer-")));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  const commands = new WorkspaceCommands(
    { projects: () => [{ cwd: project }] } as never,
    (async (_id: string, action: () => Promise<unknown>) => action()) as never,
  );
  return { root, project, run: commands.run.bind(commands) };
}

it("reads only bounded chunks from a stable file version", async () => {
  const { project, run } = await setup();
  const path = join(project, "movie.mp4");
  await writeFile(path, "abc");
  const info = (await run("read_file_info", { path })) as { size: number; version: string };
  expect(info.size).toBe(3);
  expect(
    await run("read_file_chunk", { path, version: info.version, offset: 0, length: 2 }),
  ).toEqual({ data: "YWI=", offset: 0, length: 2 });
  expect(
    await run("read_file_chunk", { path, version: info.version, offset: 2, length: 2 }),
  ).toEqual({ data: "Yw==", offset: 2, length: 1 });
  await expect(
    run("read_file_chunk", { path, version: info.version, offset: 0, length: 1024 * 1024 + 1 }),
  ).rejects.toThrow("Invalid file chunk");
  await writeFile(path, "changed");
  await expect(
    run("read_file_chunk", { path, version: info.version, offset: 0, length: 1 }),
  ).rejects.toThrow("changed while downloading");
});

it("keeps files outside registered roots and escaping symlinks inaccessible", async () => {
  const { root, project, run } = await setup();
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.csv"), "private");
  await symlink(
    outside,
    join(project, "escape"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const path of [join(outside, "secret.csv"), join(project, "escape", "secret.csv")]) {
    await expect(run("read_file_info", { path })).rejects.toThrow("outside");
    await expect(
      run("read_file_chunk", { path, version: "v1", offset: 0, length: 1 }),
    ).rejects.toThrow("outside");
  }
});

it("pins the selected folder identity while allowing its contents to change", async () => {
  const { project, run } = await setup();
  const root = join(project, "selected");
  await mkdir(root);
  await writeFile(join(root, "visible.csv"), "initial");
  const entry = (await run("read_folder_entry", { root, path: root, children: false })) as {
    rootIdentity: string;
  };
  expect(entry.rootIdentity).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(root, "new.csv"), "live");
  const changed = (await run("read_folder_entry", {
    root,
    path: root,
    rootIdentity: entry.rootIdentity,
    children: true,
  })) as { rootIdentity: string; entries: Array<{ name: string }> };
  expect(changed.rootIdentity).toBe(entry.rootIdentity);
  expect(changed.entries.map((item) => item.name)).toContain("new.csv");
  await rename(root, join(project, "previous-selected"));
  await mkdir(root);
  await writeFile(join(root, "visible.csv"), "replacement");
  await expect(
    run("read_folder_entry", {
      root,
      path: root,
      rootIdentity: entry.rootIdentity,
      children: false,
    }),
  ).rejects.toThrow("selected folder was replaced");
  await expect(
    run("read_file_info", {
      root,
      path: join(root, "visible.csv"),
      rootIdentity: entry.rootIdentity,
    }),
  ).rejects.toThrow("selected folder was replaced");
});

it("rejects a directory symlink swapped after path validation and before opening bytes", async () => {
  const { project, run } = await setup();
  const root = join(project, "selected");
  const nested = join(root, "nested");
  const outside = join(project, "outside");
  await mkdir(nested, { recursive: true });
  await mkdir(outside);
  const path = join(nested, "visible.csv");
  await writeFile(path, "public");
  await writeFile(join(outside, "visible.csv"), "private");
  const entry = (await run("read_folder_entry", { root, path: root, children: false })) as {
    rootIdentity: string;
  };
  const info = (await run("read_file_info", { root, path, rootIdentity: entry.rootIdentity })) as {
    version: string;
  };
  opening.beforeOpen = async () => {
    opening.beforeOpen = undefined;
    await rename(nested, join(root, "original-nested"));
    await symlink(outside, nested, process.platform === "win32" ? "junction" : "dir");
  };
  await expect(
    run("read_file_chunk", {
      root,
      path,
      rootIdentity: entry.rootIdentity,
      version: info.version,
      offset: 0,
      length: 7,
    }),
  ).rejects.toThrow("outside the selected folder");
});

it("rejects directories, invalid offsets and oversized files before allocating their contents", async () => {
  const { project, run } = await setup();
  const path = join(project, "large.bin");
  await writeFile(path, "");
  await truncate(path, 1024 * 1024 * 1024 + 1);
  await expect(run("read_file_info", { path })).rejects.toThrow("maximum 1 GB");
  await expect(run("read_file_info", { path: project })).rejects.toThrow();
  await expect(
    run("read_file_chunk", { path, version: "v1", offset: -1, length: 1 }),
  ).rejects.toThrow("Invalid file chunk");
});

it("confines live folder metadata and chunks to the selected root, including links inside the project", async () => {
  const { project, run } = await setup();
  const root = join(project, "selected");
  const elsewhere = join(project, "selected-other");
  await mkdir(root);
  await mkdir(elsewhere);
  await writeFile(join(root, "visible.csv"), "a,b");
  await writeFile(join(elsewhere, "private.csv"), "private");
  await symlink(elsewhere, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  const entry = (await run("read_folder_entry", { root, path: root, children: true })) as {
    isDir: boolean;
    entries: Array<{ name: string; size: number }>;
  };
  expect(entry.isDir).toBe(true);
  expect(entry.entries.map((item) => item.name)).toEqual(["visible.csv"]);
  for (const path of [join(root, "escape", "private.csv"), join(elsewhere, "private.csv")]) {
    await expect(run("read_folder_entry", { root, path, children: false })).rejects.toThrow(
      "outside the selected folder",
    );
    await expect(run("read_file_info", { root, path })).rejects.toThrow(
      "outside the selected folder",
    );
    await expect(
      run("read_file_chunk", { root, path, version: "v1", offset: 0, length: 1 }),
    ).rejects.toThrow("outside the selected folder");
  }
});
