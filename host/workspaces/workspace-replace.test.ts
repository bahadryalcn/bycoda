import { afterEach, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaceHostContent } from "./workspace-replace";
import { WorkspaceCommands } from "./workspace-commands";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function project(git = false) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "bycoda-replace-")));
  roots.push(root);
  if (git) execFileSync("git", ["init", "-q"], { cwd: root, windowsHide: true });
  return root;
}

it.each([
  [false, false, "new new newx\r\nnew\n", 4],
  [true, false, "new OLD newx\r\nnew\n", 3],
  [false, true, "new new oldx\r\nnew\n", 3],
] as const)(
  "replaces with case=%s wholeWord=%s, retaining line endings",
  async (caseSensitive, wholeWord, expected, count) => {
    const root = await project();
    await writeFile(join(root, "a.txt"), "old OLD oldx\r\nold\n");
    const options = { query: "old", replacement: "new", caseSensitive, wholeWord, dryRun: true };
    const preview = await replaceHostContent(root, options, async () => {});
    expect(preview.replacements).toBe(count);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("old OLD oldx\r\nold\n");
    const result = await replaceHostContent(
      root,
      { ...options, dryRun: false, revisions: preview.revisions },
      async () => {},
    );
    expect(result).toMatchObject({ filesChanged: 1, replacements: count, failures: [] });
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe(expected);
  },
);

it("replaces regex captures, respects filters, preserves UTF-8 BOM and skips binary files", async () => {
  const root = await project(true);
  for (const name of ["a.txt", "skip.txt", "a.md"])
    await writeFile(join(root, name), "\ufeffold12 old34\r\n");
  await writeFile(join(root, "binary.txt"), "old12\0old34");
  const options = {
    query: "old([[:digit:]]+)",
    replacement: "$1-new",
    regex: true,
    include: "*.txt",
    exclude: "skip.txt",
    dryRun: true,
  };
  const preview = await replaceHostContent(root, options, async () => {});
  expect(preview.replacements).toBe(2);
  const result = await replaceHostContent(
    root,
    { ...options, dryRun: false, revisions: preview.revisions },
    async () => {},
  );
  expect(result).toMatchObject({ filesChanged: 1, replacements: 2, failures: [] });
  expect(await readFile(join(root, "a.txt"), "utf8")).toBe("\ufeff12-new 34-new\r\n");
  expect(await readFile(join(root, "skip.txt"), "utf8")).toContain("old12");
  expect(await readFile(join(root, "a.md"), "utf8")).toContain("old12");
});

it("rejects changed reviewed bytes and revoked authority without writing", async () => {
  const root = await project();
  const path = join(root, "a.txt");
  await writeFile(path, "old");
  const options = { query: "old", replacement: "new", dryRun: true };
  const preview = await replaceHostContent(root, options, async () => {});
  await writeFile(path, "old edited");
  const result = await replaceHostContent(
    root,
    { ...options, dryRun: false, revisions: preview.revisions },
    async () => {},
  );
  expect(result.failures.join()).toContain("changed since confirmation");
  expect(await readFile(path, "utf8")).toBe("old edited");
  await writeFile(path, "old");
  const denied = await replaceHostContent(
    root,
    { ...options, dryRun: false, revisions: preview.revisions },
    async () => {
      throw new Error("revoked");
    },
  );
  expect(denied.failures.join()).toContain("revoked");
  expect(await readFile(path, "utf8")).toBe("old");
});

it("routes remote replacement through registered workspace and mutation admission", async () => {
  const root = await project();
  await writeFile(join(root, "a.txt"), "old");
  const release = vi.fn(async () => {});
  const startMutation = vi.fn(async () => release);
  const commands = new WorkspaceCommands(
    { projects: () => [{ id: "p", cwd: root }], attachmentDir: join(root, "attachments") } as never,
    async (_id, action) => await action(),
    undefined,
    { startMutation } as never,
  );
  const result = await commands.run("replace_project", {
    options: { cwd: root, query: "old", replacement: "new", dryRun: true },
  });
  expect(result).toMatchObject({ filesChanged: 1, replacements: 1 });
  expect(startMutation).toHaveBeenCalledWith(root);
  expect(release).toHaveBeenCalledOnce();
  await expect(
    commands.run("replace_project", {
      options: { cwd: tmpdir(), query: "old", replacement: "new", dryRun: true },
    }),
  ).rejects.toThrow();
});

it("keeps unknown capture references empty and bounds output before publication", async () => {
  const root = await project(true);
  const path = join(root, "a.txt");
  await writeFile(path, "old");
  const options = { query: "old", replacement: "$1", regex: true, dryRun: true };
  const preview = await replaceHostContent(root, options, async () => {});
  const result = await replaceHostContent(
    root,
    { ...options, dryRun: false, revisions: preview.revisions },
    async () => {},
  );
  expect(result.failures).toEqual([]);
  expect(await readFile(path, "utf8")).toBe("");
  await writeFile(path, "old old");
  const oversized = await replaceHostContent(
    root,
    { ...options, replacement: "x".repeat(512 * 1024) },
    async () => {},
  );
  expect(oversized.failures.join()).toContain("exceed 512 KiB");
  expect(await readFile(path, "utf8")).toBe("old old");
});

it("keeps a UTF-8 BOM before anchored regex replacement", async () => {
  const root = await project(true);
  const path = join(root, "a.txt");
  await writeFile(path, "\ufeffold");
  const options = { query: "^", regex: true, replacement: "new", dryRun: true };
  const preview = await replaceHostContent(root, options, async () => {});
  const result = await replaceHostContent(
    root,
    { ...options, dryRun: false, revisions: preview.revisions },
    async () => {},
  );
  expect(result.failures).toEqual([]);
  expect(await readFile(path, "utf8")).toBe("\ufeffnewold");
});
