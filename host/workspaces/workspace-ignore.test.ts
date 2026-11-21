import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostFiles } from "./workspace";

// Record the args and stdin sent to Git and return the configured ignored paths.
const fake = vi.hoisted(() => ({
  calls: [] as { args: string[]; input: string }[],
  reply: "",
}));

vi.mock("../git/git-exec-pool", () => ({
  hostGitExec: {
    exec: async (_command: string, args: string[], options: { input: string }) => {
      fake.calls.push({ args, input: options.input });
      return { stdout: fake.reply, stderr: "" };
    },
  },
}));

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "bycoda-ignore-"));
  fake.calls.length = 0;
  fake.reply = "";
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it("sends ignore candidates on stdin, not argv, and keeps exact filenames", async () => {
  await writeFile(join(root, "with space.txt"), "x");
  await writeFile(join(root, "ünïcode.log"), "x");
  await mkdir(join(root, "dist"));
  fake.reply = "dist\0ünïcode.log\0";

  const entries = await listHostFiles(root, "");

  expect(fake.calls).toHaveLength(1);
  const [call] = fake.calls;
  expect(call.args).toEqual(expect.arrayContaining(["check-ignore", "-z", "--stdin"]));
  expect(call.args).not.toContain("--");
  expect(call.args.some((arg) => arg.includes("dist") || arg.includes(".txt"))).toBe(false);
  expect(call.input.split("\0").filter(Boolean).sort()).toEqual([
    "dist",
    "with space.txt",
    "ünïcode.log",
  ]);
  const ignored = Object.fromEntries(entries.map((entry) => [entry.name, entry.ignored]));
  expect(ignored).toEqual({ dist: true, "ünïcode.log": true, "with space.txt": false });
});

it("keeps the git command line small for a folder with many long paths", async () => {
  const dir = join(root, "data");
  await mkdir(dir);
  const names = Array.from({ length: 300 }, (_, i) => `${"segment-".repeat(20)}${i}.bin`);
  await Promise.all(names.map((name) => writeFile(join(dir, name), "")));
  fake.reply = `data/${names[0]}\0`;

  const entries = await listHostFiles(root, "data");

  expect(fake.calls).toHaveLength(1);
  const [call] = fake.calls;
  expect(call.args.join(" ").length).toBeLessThan(500);
  expect(call.input.split("\0").filter(Boolean)).toHaveLength(300);
  expect(entries).toHaveLength(300);
  expect(entries.filter((entry) => entry.ignored).map((entry) => entry.name)).toEqual([names[0]]);
});
