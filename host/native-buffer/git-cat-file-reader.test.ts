import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createCatFileReader, type CatFileReader } from "./git-cat-file-reader";

let dir: string;
let reader: CatFileReader;
const env = () => ({ ...process.env, GIT_DIR: dir });
const git = (args: string[], input?: string) =>
  execFileSync("git", args, { env: env(), input, windowsHide: true }).toString().trim();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cat-file-reader-"));
  git(["init", "--bare", "--quiet"]);
  reader = createCatFileReader({ git: "git", cwd: tmpdir(), env: env(), timeoutMs: 10_000 });
});
afterEach(async () => {
  reader.close();
  await rm(dir, { recursive: true, force: true });
});

it("answers headers, bodies and missing objects from one process", async () => {
  const oid = git(["hash-object", "-w", "--stdin"], "hello\n");
  const [info, body, missing] = await Promise.all([
    reader.info(oid),
    reader.contents(oid),
    reader.info("0".repeat(40)),
  ]);
  expect(info).toEqual({ oid, type: "blob", size: 6 });
  expect(body?.body?.toString()).toBe("hello\n");
  expect(missing).toBeNull();
});

it("sees objects and refs written by other git processes after it started", async () => {
  expect(await reader.info("refs/heads/main")).toBeNull();
  const blob = git(["hash-object", "-w", "--stdin"], "later");
  const tree = git(["mktree"], `100644 blob ${blob}\tfile\n`);
  const commit = git(["commit-tree", tree, "-m", "one"]);
  git(["update-ref", "refs/heads/main", commit]);
  expect((await reader.contents("refs/heads/main:file"))?.body?.toString()).toBe("later");
  const next = git(["commit-tree", tree, "-m", "two"]);
  git(["update-ref", "refs/heads/main", next]);
  expect((await reader.info("refs/heads/main"))?.oid).toBe(next);
});

it("still answers requests sent before close and starts a new process after it", async () => {
  const oid = git(["hash-object", "-w", "--stdin"], "x");
  const sent = reader.contents(oid);
  reader.close();
  expect((await sent)?.body?.toString()).toBe("x");
  expect((await reader.info(oid))?.size).toBe(1);
});

it("rejects names that would split a request line", async () => {
  await expect(reader.info("a\nb")).rejects.toThrow("Invalid git object name");
});
