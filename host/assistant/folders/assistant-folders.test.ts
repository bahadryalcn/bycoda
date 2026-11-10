import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AssistantRequestValidationSchema,
  AssistantResponseValidationSchema,
} from "../../../src/shared/model/host-contracts/assistant";
import {
  assertAssistantFolderAllowed,
  assistantFolderId,
  assistantFoldersOp,
  canonicalAssistantFolder,
  getAssistantFolders,
  resolveAssistantFolder,
  setAssistantFolders,
} from "./assistant-folders";

const win = {
  platform: "win32" as const,
  home: "C:\\Users\\me",
  env: { SystemRoot: "C:\\Windows" },
};
const posix = { platform: "linux" as const, home: "/home/me", env: {} };

describe("assertAssistantFolderAllowed", () => {
  it.each([
    [win, "C:\\Windows"],
    [win, "C:\\Windows\\System32"],
    [win, "c:\\program files\\app"],
    [win, "C:\\ProgramData"],
    [win, "C:\\Users\\me\\.ssh"],
    [win, "C:\\Users\\me\\.ssh\\keys"],
    [win, "\\\\server\\share\\folder"],
    [posix, "/etc"],
    [posix, "/etc/ssh"],
    [posix, "/usr/local"],
    [posix, "/var"],
    [posix, "/home/me/.gnupg"],
    [{ ...posix, platform: "darwin" as const }, "/system/library"],
  ])("rejects %j %s", (context, path) => {
    expect(() => assertAssistantFolderAllowed(path, context)).toThrow();
  });

  it.each([
    [win, "C:\\Users\\me\\Documents"],
    [win, "D:\\work\\notes"],
    [posix, "/home/me/projects"],
    [posix, "/srv/data"],
    [posix, "/var/www/site"],
    // A whole drive, the home folder and its parents may be chosen; the tools refuse
    // protected folders inside them per path.
    [win, "C:\\"],
    [win, "D:\\"],
    [win, "C:\\Users"],
    [win, "C:\\Users\\me"],
    [posix, "/"],
    [posix, "/home"],
    [posix, "/home/me"],
  ])("accepts %j %s", (context, path) => {
    expect(() => assertAssistantFolderAllowed(path, context)).not.toThrow();
  });

  it("rejects a relative path", () => {
    expect(() => assertAssistantFolderAllowed("docs", posix)).toThrow(/absolute/);
  });
});

describe("canonicalAssistantFolder", () => {
  let base: string;
  const context = () => ({ platform: process.platform, home: join(base, "home"), env: {} });
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "assistant-folders-"));
    await mkdir(join(base, "home", "work"), { recursive: true });
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  it("returns the physical path of an existing folder", async () => {
    const real = await canonicalAssistantFolder(join(base, "home", "work"), context());
    expect(real.toLowerCase()).toContain("work");
  });

  it("rejects a missing path, a file, a relative path and a credential folder", async () => {
    await mkdir(join(base, "home", ".ssh"));
    await writeFile(join(base, "home", "file.txt"), "x");
    await expect(canonicalAssistantFolder(join(base, "nope"), context())).rejects.toThrow(
      /does not exist/,
    );
    await expect(
      canonicalAssistantFolder(join(base, "home", "file.txt"), context()),
    ).rejects.toThrow(/folder, not a file/);
    await expect(canonicalAssistantFolder("work", context())).rejects.toThrow(/absolute/);
    await expect(canonicalAssistantFolder(join(base, "home", ".ssh"), context())).rejects.toThrow(
      /credential/,
    );
  });

  it("resolves a link to its target and applies the rules to the target", async () => {
    const link = join(base, "home", "link");
    try {
      await symlink(join(base, "home", "work"), link, "junction");
    } catch {
      return; // links unavailable on this machine
    }
    const real = await canonicalAssistantFolder(link, context());
    expect(real.toLowerCase().endsWith("work")).toBe(true);
    // A link that points at a credential folder is that credential folder.
    await mkdir(join(base, "home", ".ssh"));
    const escape = join(base, "escape");
    await symlink(join(base, "home", ".ssh"), escape, "junction");
    await expect(canonicalAssistantFolder(escape, context())).rejects.toThrow(/credential/);
  });
});

function deps() {
  const records = new Map<
    string,
    { version: number; createdAt: number; updatedAt: number; value: never }
  >();
  return {
    repository: {
      get: async (_table: string, id: string) => records.get(id),
      put: async (
        _table: string,
        value: { id: string; value: never; createdAt: number; updatedAt: number },
        expected?: number,
      ) => {
        const old = records.get(value.id);
        if ((old?.version ?? 0) !== expected) throw new Error("stale");
        const next = { ...value, version: (old?.version ?? 0) + 1 };
        records.set(value.id, next);
        return next;
      },
    } as never,
    now: () => 1000,
  };
}

describe("Assistant folder settings", () => {
  let base: string;
  const context = () => ({ platform: process.platform, home: join(base, "home"), env: {} });
  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), "assistant-folders-"));
    await mkdir(join(base, "home", "a"), { recursive: true });
    await mkdir(join(base, "home", "b"), { recursive: true });
  });
  afterEach(() => rm(base, { recursive: true, force: true }));

  it("starts empty with commands asking", async () => {
    expect(await getAssistantFolders(deps())).toMatchObject({
      folders: [],
      runWithoutAsking: false,
      version: 0,
    });
  });

  it("saves canonical, de-duplicated folders with a stable id and bumps the version", async () => {
    const d = deps();
    const a = join(base, "home", "a");
    const saved = await setAssistantFolders(d, 0, [a, a, join(base, "home", "b")], true, context());
    expect(saved.folders).toHaveLength(2);
    expect(saved.runWithoutAsking).toBe(true);
    expect(saved.version).toBe(1);
    expect(saved.folders[0].id).toBe(assistantFolderId(saved.folders[0].path));
    await expect(setAssistantFolders(d, 0, [a], false, context())).rejects.toThrow(/changed/);
  });

  it("rejects one bad path without saving anything", async () => {
    const d = deps();
    await mkdir(join(base, "home", ".ssh"));
    await expect(
      setAssistantFolders(
        d,
        0,
        [join(base, "home", "a"), join(base, "home", ".ssh")],
        false,
        context(),
      ),
    ).rejects.toThrow(/credential/);
    expect((await getAssistantFolders(d)).folders).toEqual([]);
  });

  it("allows at most 20 folders", async () => {
    await expect(
      setAssistantFolders(
        deps(),
        0,
        Array.from({ length: 21 }, (_, i) => `/f${i}`),
        false,
      ),
    ).rejects.toThrow(/At most 20/);
    expect(
      AssistantRequestValidationSchema.safeParse({
        op: "folders.set",
        expectedVersion: 0,
        paths: Array.from({ length: 21 }, (_, i) => `/f${i}`),
        runWithoutAsking: false,
      }).success,
    ).toBe(false);
  });

  it("is writable only by the owner, readable by the assistant", async () => {
    const d = deps();
    const input = {
      op: "folders.set" as const,
      expectedVersion: 0,
      paths: [join(base, "home", "a")],
      runWithoutAsking: true,
    };
    await expect(assistantFoldersOp(input, "assistant", d)).rejects.toThrow(/owner/);
    await expect(assistantFoldersOp(input, "voice", d)).rejects.toThrow(/owner/);
    expect((await getAssistantFolders(d)).runWithoutAsking).toBe(false);
    const read = await assistantFoldersOp({ op: "folders.get" }, "assistant", d);
    expect(AssistantResponseValidationSchema.safeParse({ ok: true, ...read }).success).toBe(true);
  });

  it("resolves a saved id again at use and refuses an unknown id or a changed folder", async () => {
    const d = deps();
    const a = join(base, "home", "a");
    const saved = await setAssistantFolders(d, 0, [a], false, context());
    const id = saved.folders[0].id;
    expect(await resolveAssistantFolder(saved, id, context())).toBe(saved.folders[0].path);
    await expect(resolveAssistantFolder(saved, "fdeadbeef", context())).rejects.toThrow(/Unknown/);
    await expect(resolveAssistantFolder(saved, "../x", context())).rejects.toThrow(/Unknown/);
    await rm(a, { recursive: true });
    await expect(resolveAssistantFolder(saved, id, context())).rejects.toThrow(/does not exist/);
    // A folder that later becomes a link to somewhere else is refused, not followed.
    try {
      await symlink(join(base, "home", "b"), a, "junction");
    } catch {
      return;
    }
    await expect(resolveAssistantFolder(saved, id, context())).rejects.toThrow(
      /replaced by a link/,
    );
  });
});
