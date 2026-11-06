import { afterEach, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publishWorkspaceFile, windowsOperationError } from "./workspace-publication";

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
    platform: "win32" as NodeJS.Platform,
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

it.each(["write", "sync"] as const)(
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

it("retains staged and backup candidates when replacement outcome is uncertain", async () => {
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
});

it("reports successful publication even if backup cleanup fails", async () => {
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
});

it("retains staging when replacement fails before moving the target", async () => {
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
});

it("rejects revoked authority after replacement helper is ready", async () => {
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
});

it("reports the PowerShell error text without CLIXML progress records", () => {
  const stderr =
    '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04"><Obj S="progress" RefId="0"><TN RefId="0"><T>System.Management.Automation.PSCustomObject</T></TN><MS><PR N="Record"><AV>Preparing modules for first use.</AV></PR></MS></Obj></Objs>Staging DACL differs from original\r\n';
  const error = windowsOperationError(true, false, stderr, 1);
  expect(error.message).toBe(
    "Windows staging permissions failed: Staging DACL differs from original",
  );
  expect(error.message).not.toMatch(/CLIXML|<Objs/);
  expect(windowsOperationError(false, true, "", null).message).toBe(
    "Windows replacement outcome is uncertain (timeout): exit code unknown",
  );
});

it("reports a target changed before staging permissions as a conflict", async () => {
  const f = await fixture();
  f.operations.windows = async (_staged, _target, protect) => {
    if (protect) {
      await writeFile(f.target, "editor");
      throw new Error("Windows staging permissions failed: target replaced");
    }
    throw new Error("publication must not run");
  };
  await expect(
    publishWorkspaceFile(
      f.target,
      "after",
      f.original,
      async () => {
        if ((await readFile(f.target, "utf8")) !== "before")
          throw new Error("File changed on the host; reload before saving");
      },
      f.operations,
    ),
  ).rejects.toThrow("File changed on the host");
  expect(await readFile(f.target, "utf8")).toBe("editor");
  expect(await readdir(f.root)).toEqual(["file.txt"]);
});

it("surfaces the cleaned permissions failure when the target is unchanged", async () => {
  const f = await fixture();
  let validations = 0;
  f.operations.windows = async (_staged, _target, protect) => {
    if (protect)
      throw windowsOperationError(
        true,
        false,
        '#< CLIXML\r\n<Objs Version="1.1.0.1"><Obj S="progress" RefId="0"></Obj></Objs>Access denied.\r\n',
        1,
      );
    throw new Error("publication must not run");
  };
  await expect(
    publishWorkspaceFile(
      f.target,
      "after",
      f.original,
      async () => {
        validations++;
      },
      f.operations,
    ),
  ).rejects.toThrow(/^Windows staging permissions failed: Access denied\.$/);
  expect(validations).toBe(1);
  expect(await readFile(f.target, "utf8")).toBe("before");
  expect(await readdir(f.root)).toEqual(["file.txt"]);
});
