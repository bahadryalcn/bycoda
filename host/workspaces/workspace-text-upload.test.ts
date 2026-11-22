import { afterEach, expect, it, vi } from "vitest";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorkspaceCommands } from "./workspace-commands";
import { MAX_EDIT_TEXT_BYTES, UPLOAD_TTL_MS } from "./workspace-text-upload";

vi.mock("../git/git-worktrees", () => ({ hostWorktrees: vi.fn() }));
/** Makes staged files accept at most `limit` bytes per write call, like a partial disk write. */
const writes = vi.hoisted(() => ({ limit: undefined as number | undefined, calls: 0 }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      if (!String(args[0]).includes(".bycoda-upload-")) return handle;
      const write = handle.write.bind(handle) as (...a: unknown[]) => Promise<unknown>;
      (handle as { write: unknown }).write = (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => {
        writes.calls += 1;
        if (writes.limit === 0) return Promise.resolve({ bytesWritten: 0, buffer });
        return write(buffer, offset, Math.min(length, writes.limit ?? length), position);
      };
      return handle;
    },
  };
});
const renameHooks = vi.hoisted(() => ({
  after: undefined as undefined | (() => Promise<void>),
}));
vi.mock("../storage/rename-retry", async (original) => {
  const actual = await original<typeof import("../storage/rename-retry")>();
  return {
    ...actual,
    renameWithRetry: async (from: string, to: string) => {
      await actual.renameWithRetry(from, to);
      await renameHooks.after?.();
    },
  };
});

const CHUNK = 512 * 1024;
const roots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  writes.limit = undefined;
  writes.calls = 0;
  renameHooks.after = undefined;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-upload-")));
  roots.push(root);
  const project = join(root, "project");
  await mkdir(project);
  const commands = new WorkspaceCommands(
    { projects: () => [{ cwd: project }], attachmentDir: join(root, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  const path = join(project, "doc.txt");
  const version = async () =>
    ((await commands.run("read_file_info", { path })) as { version: string }).version;
  return { root, project, path, commands, version };
}

type Commands = Awaited<ReturnType<typeof setup>>["commands"];

async function begin(commands: Commands, path: string, size: number, baseVersion?: string) {
  return (await commands.run("write_file_begin", { path, size, baseVersion })) as {
    uploadId: string;
  };
}

async function send(commands: Commands, path: string, uploadId: string, bytes: Buffer, from = 0) {
  for (let offset = from; offset < bytes.length; offset += CHUNK)
    await commands.run("write_file_chunk", {
      path,
      uploadId,
      offset,
      data: bytes.subarray(offset, offset + CHUNK).toString("base64"),
    });
}

async function upload(commands: Commands, path: string, bytes: Buffer, baseVersion?: string) {
  const { uploadId } = await begin(commands, path, bytes.length, baseVersion);
  await send(commands, path, uploadId, bytes);
  return (await commands.run("write_file_commit", { path, uploadId })) as { version: string };
}

/** `lead` + 3-byte characters + `tail`, exactly `total` bytes, so a chunk edge splits a character. */
function multibyte(total: number): Buffer {
  const count = Math.floor((total - 2) / 3);
  const text = `a${"漢".repeat(count)}${"b".repeat(total - 1 - count * 3)}`;
  const bytes = Buffer.from(text, "utf8");
  expect(bytes.length).toBe(total);
  return bytes;
}

const STAGING = ".bycoda-uploads";
/** Temporaries staged for a folder, from the Host's staging folder (absent when empty). */
const leftovers = async (dir: string) =>
  (await readdir(join(dir, STAGING)).catch(() => [] as string[])).filter((name) =>
    name.startsWith(".bycoda-upload-"),
  );

it.each([2 * 1024 * 1024, MAX_EDIT_TEXT_BYTES])(
  "round-trips %i UTF-8 bytes through a chunked save byte for byte",
  async (total) => {
    const { project, path, commands, version } = await setup();
    await writeFile(path, "original");
    const bytes = multibyte(total);
    const baseVersion = await version();
    const { version: saved } = await upload(commands, path, bytes, baseVersion);
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    expect(saved).toBe(await version());
    expect(await leftovers(project)).toEqual([]);
    // The returned version chains the next save and the text still decodes.
    await upload(commands, path, Buffer.from("next"), saved);
    expect(await readFile(path, "utf8")).toBe("next");
  },
);

it("refuses a save over the limit and a missing size before staging anything", async () => {
  const { project, path, commands } = await setup();
  await expect(begin(commands, path, MAX_EDIT_TEXT_BYTES + 1)).rejects.toThrow(
    "File is too large to save (maximum 8 MB).",
  );
  await expect(begin(commands, path, -1)).rejects.toThrow("Invalid upload size");
  expect(await readdir(project)).toEqual([]);
});

it("advertises the text edit limit only for workspace reads", async () => {
  const { path, commands } = await setup();
  await writeFile(path, "x");
  expect(await commands.run("read_file_info", { path })).toMatchObject({
    textEditLimit: MAX_EDIT_TEXT_BYTES,
  });
});

it("keeps the original and removes the temporary when an upload is aborted midway", async () => {
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const { uploadId } = await begin(commands, path, CHUNK * 2);
  await send(commands, path, uploadId, Buffer.alloc(CHUNK, 97));
  expect((await leftovers(project)).length).toBe(1);
  await commands.run("write_file_abort", { path, uploadId });
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await leftovers(project)).toEqual([]);
  // The id is gone: a late chunk or commit cannot revive it.
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toThrow(
    "Upload not found",
  );
});

it("refuses to commit an incomplete upload and discards it", async () => {
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const { uploadId } = await begin(commands, path, CHUNK * 2);
  await send(commands, path, uploadId, Buffer.alloc(CHUNK, 97));
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toThrow("incomplete");
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await leftovers(project)).toEqual([]);
});

it("expires an abandoned upload and removes its temporary", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const { uploadId } = await begin(commands, path, 4);
  expect((await leftovers(project)).length).toBe(1);
  await vi.advanceTimersByTimeAsync(UPLOAD_TTL_MS + 1);
  await vi.waitFor(async () => expect(await leftovers(project)).toEqual([]), { timeout: 5000 });
  expect(await readFile(path, "utf8")).toBe("original");
  await expect(
    commands.run("write_file_chunk", { path, uploadId, offset: 0, data: "YWJj" }),
  ).rejects.toThrow("Upload not found");
});

it("sweeps only staged temporaries that still are the recorded file after a restart", async () => {
  const { root, project, path } = await setup();
  const staging = join(project, STAGING);
  await mkdir(staging);
  const name = (digit: string) => `.bycoda-upload-${digit.repeat(8)}-0000-0000-0000-000000000000`;
  const entry = async (file: string) => {
    const info = await lstat(file, { bigint: true });
    return { path: file, dev: String(info.dev), ino: String(info.ino), size: Number(info.size) };
  };
  const stale = join(staging, name("0"));
  await writeFile(stale, "partial");
  const replaced = join(staging, name("1"));
  await writeFile(replaced, "partial");
  const replacedEntry = await entry(replaced);
  // Another file took the name while the Host was down: same name, different file.
  await rename(replaced, join(project, "moved-aside"));
  await writeFile(replaced, "someone else's file");
  const outside = join(project, name("2"));
  await writeFile(outside, "not staged by the Host");
  await writeFile(path, "original");
  const state = join(root, "state");
  await mkdir(state);
  await writeFile(
    join(state, "workspace-text-uploads.json"),
    JSON.stringify({
      temporaries: [await entry(stale), replacedEntry, await entry(outside), await entry(path)],
    }),
  );
  const restarted = new WorkspaceCommands(
    { projects: () => [{ cwd: project }], attachmentDir: join(state, "attachments") } as never,
    (async (_id: string, action: () => Promise<unknown>) => await action()) as never,
  );
  // A begin waits for the sweep, so afterwards the stale file is certainly gone.
  const { uploadId } = await begin(restarted, path, 1);
  await restarted.run("write_file_abort", { path, uploadId });
  expect(await leftovers(project)).toEqual([name("1")]);
  expect(await readFile(replaced, "utf8")).toBe("someone else's file");
  expect(await readFile(outside, "utf8")).toBe("not staged by the Host");
  expect(await readFile(path, "utf8")).toBe("original");
});

it("finishes a short write of a chunk and refuses a commit whose real size is wrong", async () => {
  const { path, commands } = await setup();
  await writeFile(path, "original");
  const bytes = multibyte(CHUNK + 5000);
  writes.limit = 1000;
  const { uploadId } = await begin(commands, path, bytes.length);
  await send(commands, path, uploadId, bytes);
  expect(writes.calls).toBeGreaterThan(Math.ceil(bytes.length / 1000) - 1);
  await commands.run("write_file_commit", { path, uploadId });
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);

  // A write that stops making progress fails the chunk instead of claiming it arrived.
  writes.limit = 0;
  const stalled = await begin(commands, path, 4);
  await expect(send(commands, path, stalled.uploadId, Buffer.from("abcd"))).rejects.toThrow(
    "written completely",
  );
  writes.limit = undefined;
  // Nothing was acknowledged, so the upload is incomplete.
  await expect(
    commands.run("write_file_commit", { path, uploadId: stalled.uploadId }),
  ).rejects.toThrow("incomplete");
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("refuses to commit when the file lost bytes after they were acknowledged", async () => {
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const { uploadId } = await begin(commands, path, 8);
  await send(commands, path, uploadId, Buffer.from("12345678"));
  const [name] = await leftovers(project);
  await truncate(join(project, STAGING, name!), 3);
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toThrow("incomplete");
  expect(await readFile(path, "utf8")).toBe("original");
});

it("never renames a staging entry that was swapped for another file", async () => {
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const { uploadId } = await begin(commands, path, 4);
  await send(commands, path, uploadId, Buffer.from("mine"));
  const [name] = await leftovers(project);
  const staged = join(project, STAGING, name!);
  // The upload's file moves away and a different file of the right size takes its name.
  await rename(staged, join(project, "moved-aside"));
  await writeFile(staged, "evil");
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toThrow(
    "staged upload changed",
  );
  expect(await readFile(path, "utf8")).toBe("original");
  // Cleanup does not delete a file it did not create.
  expect(await readFile(staged, "utf8")).toBe("evil");
});

it("never renames a staging entry replaced by a link", async () => {
  const { project, path, commands } = await setup();
  await writeFile(path, "original");
  const decoy = join(project, "decoy.txt");
  await writeFile(decoy, "evil");
  const { uploadId } = await begin(commands, path, 4);
  await send(commands, path, uploadId, Buffer.from("mine"));
  const [name] = await leftovers(project);
  const staged = join(project, STAGING, name!);
  await rename(staged, join(project, "moved-aside"));
  try {
    await symlink(decoy, staged);
  } catch {
    // Creating links needs a privilege some Windows accounts lack; the swapped-file test covers it.
    await commands.run("write_file_abort", { path, uploadId });
    return;
  }
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toThrow(
    "staged upload changed",
  );
  expect(await readFile(path, "utf8")).toBe("original");
  expect(await readFile(decoy, "utf8")).toBe("evil");
});

it("refuses a staging folder that is a link", async () => {
  const { project, path, commands } = await setup();
  const elsewhere = join(project, "elsewhere");
  await mkdir(elsewhere);
  try {
    await symlink(elsewhere, join(project, STAGING), "dir");
  } catch {
    return;
  }
  await expect(begin(commands, path, 1)).rejects.toThrow("Cannot stage");
  expect(await readdir(elsewhere)).toEqual([]);
});

it("counts parallel begins against the upload limit", async () => {
  const { path, commands } = await setup();
  const results = await Promise.allSettled(
    Array.from({ length: 10 }, () => begin(commands, path, 1)),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  expect(ok.length).toBe(4);
  for (const r of results)
    if (r.status === "rejected") expect(String(r.reason)).toContain("Too many file saves");
  for (const r of ok)
    await commands.run("write_file_abort", {
      path,
      uploadId: (r as { value: { uploadId: string } }).value.uploadId,
    });
  // Failed or released reservations free their slots again.
  const again = await begin(commands, path, 1);
  await commands.run("write_file_abort", { path, uploadId: again.uploadId });
});

it("refuses a stale base version at begin and at commit, and leaves the file alone", async () => {
  const { project, path, commands, version } = await setup();
  await writeFile(path, "base");
  const baseVersion = await version();
  await writeFile(path, "someone else");
  await expect(begin(commands, path, 4, baseVersion)).rejects.toMatchObject({
    code: "FILE_CHANGED",
  });
  expect(await leftovers(project)).toEqual([]);

  const current = await version();
  const { uploadId } = await begin(commands, path, 4, current);
  await send(commands, path, uploadId, Buffer.from("mine"));
  await writeFile(path, "changed during upload");
  await expect(commands.run("write_file_commit", { path, uploadId })).rejects.toMatchObject({
    code: "FILE_CHANGED",
  });
  expect(await readFile(path, "utf8")).toBe("changed during upload");
  expect(await leftovers(project)).toEqual([]);
});

it("does not report a version for a file replaced right after the commit rename", async () => {
  const { path, commands, version } = await setup();
  await writeFile(path, "base");
  const baseVersion = await version();
  renameHooks.after = async () => {
    renameHooks.after = undefined;
    await rm(path);
    await writeFile(path, "external edit after rename");
  };
  await expect(upload(commands, path, Buffer.from("mine"), baseVersion)).rejects.toMatchObject({
    code: "FILE_CHANGED",
  });
});

it("acknowledges a retried chunk once and a retried commit with the same version", async () => {
  const { path, commands } = await setup();
  const bytes = multibyte(CHUNK * 2 + 10);
  const { uploadId } = await begin(commands, path, bytes.length);
  const chunk = (offset: number, data = bytes.subarray(offset, offset + CHUNK)) =>
    commands.run("write_file_chunk", { path, uploadId, offset, data: data.toString("base64") });
  expect(await chunk(0)).toEqual({ received: CHUNK });
  // The reply was lost: the same chunk again is a no-op, not a duplicate append.
  expect(await chunk(0)).toEqual({ received: CHUNK });
  // Different bytes at an already written offset, or a gap, are refused.
  await expect(chunk(0, Buffer.alloc(CHUNK, 1))).rejects.toThrow("Invalid upload offset");
  await expect(chunk(CHUNK * 2)).rejects.toThrow("Invalid upload offset");
  expect(await chunk(CHUNK)).toEqual({ received: CHUNK * 2 });
  expect(await chunk(CHUNK * 2)).toEqual({ received: bytes.length });
  const first = await commands.run("write_file_commit", { path, uploadId });
  expect(await commands.run("write_file_commit", { path, uploadId })).toEqual(first);
  expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
});

it("rejects malformed chunks and chunks past the announced size", async () => {
  const { path, commands } = await setup();
  const { uploadId } = await begin(commands, path, 3);
  for (const data of ["", "***!", "abc", Buffer.alloc(CHUNK + 1).toString("base64")])
    await expect(
      commands.run("write_file_chunk", { path, uploadId, offset: 0, data }),
    ).rejects.toThrow("Invalid upload chunk");
  await expect(
    commands.run("write_file_chunk", {
      path,
      uploadId,
      offset: 0,
      data: Buffer.from("four").toString("base64"),
    }),
  ).rejects.toThrow("larger than announced");
  await commands.run("write_file_abort", { path, uploadId });
});

it("scopes an upload to its owner and bounds concurrent uploads", async () => {
  const { path, commands } = await setup();
  const { uploadId } = await begin(commands, path, 3);
  const data = Buffer.from("abc").toString("base64");
  await expect(
    commands.run("write_file_chunk", { path, uploadId, offset: 0, data }, "someone-else"),
  ).rejects.toThrow("Upload not found");
  expect(await commands.run("write_file_abort", { path, uploadId }, "someone-else")).toEqual({
    aborted: false,
  });
  const ids = [uploadId];
  for (let index = 0; index < 3; index++) ids.push((await begin(commands, path, 1)).uploadId);
  await expect(begin(commands, path, 1)).rejects.toThrow("Too many file saves");
  for (const id of ids) await commands.run("write_file_abort", { path, uploadId: id });
  const again = await begin(commands, path, 1);
  await commands.run("write_file_abort", { path, uploadId: again.uploadId });
});
