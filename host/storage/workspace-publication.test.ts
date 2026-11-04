import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishWorkspaceFile } from "./workspace-publication";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "bycoda-publication-test-"));
  roots.push(root);
  const target = join(root, "file.txt");
  await writeFile(target, "before");
  const original = await stat(target);
  const operations = {
    write: (handle: FileHandle, content: string) => handle.writeFile(content),
    sync: (handle: FileHandle) => handle.sync(),
    windows: async (
      _staged: string,
      _target: string,
      _protect: boolean,
      _backup: string,
      permit?: () => Promise<void>,
    ) => {
      await permit?.();
    },
    rename,
    remove: rm,
  };
  return { root, target, original, operations };
}

it.skipIf(process.platform !== "win32").each(["write", "sync"] as const)(
  "retains the old file and removes staging when %s fails before publication",
  async (failure) => {
    const f = await fixture();
    f.operations[failure] = async () => {
      throw new Error(`injected ${failure}`);
    };
    await expect(
      publishWorkspaceFile(f.target, "after", f.original, async () => {}, f.operations),
    ).rejects.toThrow(`injected ${failure}`);
    expect(await readFile(f.target, "utf8")).toBe("before");
    expect(await readdir(f.root)).toEqual(["file.txt"]);
  },
);

it.skipIf(process.platform !== "win32")(
  "retains staged and backup candidates when replacement outcome is uncertain",
  async () => {
    const f = await fixture();
    f.operations.windows = async (_staged, target, protect, backup, permit) => {
      if (protect) return;
      await permit?.();
      await rename(target, backup);
      throw new Error("injected partial replacement");
    };
    await expect(
      publishWorkspaceFile(f.target, "after", f.original, async () => {}, f.operations),
    ).rejects.toThrow("outcome uncertain");
    const names = await readdir(f.root);
    const staged = names.find((name) => name.endsWith(".tmp"));
    const backup = names.find((name) => name.endsWith(".backup"));
    expect(staged).toBeDefined();
    expect(backup).toBeDefined();
    expect(await readFile(join(f.root, staged!), "utf8")).toBe("after");
    expect(await readFile(join(f.root, backup!), "utf8")).toBe("before");
  },
);

it.skipIf(process.platform !== "win32")(
  "reports successful publication even if backup cleanup fails",
  async () => {
    const f = await fixture();
    f.operations.windows = async (staged, target, protect, backup, permit) => {
      if (protect) return;
      await permit?.();
      await rename(target, backup);
      await rename(staged, target);
    };
    f.operations.remove = async () => {
      throw new Error("injected cleanup failure");
    };
    await expect(
      publishWorkspaceFile(f.target, "after", f.original, async () => {}, f.operations),
    ).resolves.toBeUndefined();
    expect(await readFile(f.target, "utf8")).toBe("after");
    expect((await readdir(f.root)).some((name) => name.endsWith(".backup"))).toBe(true);
  },
);

it.skipIf(process.platform !== "win32")(
  "retains staging when replacement fails before moving the target",
  async () => {
    const f = await fixture();
    f.operations.windows = async (_staged, _target, protect, _backup, permit) => {
      if (protect) return;
      await permit?.();
      throw new Error("injected replacement failure");
    };
    await expect(
      publishWorkspaceFile(f.target, "after", f.original, async () => {}, f.operations),
    ).rejects.toThrow("outcome uncertain");
    expect(await readFile(f.target, "utf8")).toBe("before");
    const staged = (await readdir(f.root)).find((name) => name.endsWith(".tmp"));
    expect(staged).toBeDefined();
    expect(await readFile(join(f.root, staged!), "utf8")).toBe("after");
  },
);

it.skipIf(process.platform !== "win32")(
  "rejects revoked authority after replacement helper is ready",
  async () => {
    const f = await fixture();
    let ready = false;
    f.operations.windows = async (_staged, _target, protect, _backup, permit) => {
      if (protect) return;
      ready = true;
      await permit?.();
      throw new Error("publication must not run");
    };
    await expect(
      publishWorkspaceFile(
        f.target,
        "after",
        f.original,
        async () => {
          expect(ready).toBe(true);
          throw new Error("authorization was revoked");
        },
        f.operations,
      ),
    ).rejects.toThrow("authorization was revoked");
    expect(await readFile(f.target, "utf8")).toBe("before");
    expect(await readdir(f.root)).toEqual(["file.txt"]);
  },
);
