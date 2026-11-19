import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listHostFiles } from "./workspace";

// Fake `git check-ignore`: records what was spawned and what was written to stdin,
// then answers with the NUL-terminated list the test sets.
const fake = vi.hoisted(() => ({
  calls: [] as { args: string[]; input: string }[],
  reply: "",
}));

vi.mock("node:child_process", async (importOriginal) => {
  const { EventEmitter } = await import("node:events");
  const { Writable } = await import("node:stream");
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (_command: string, args: string[]) => {
      const child = new EventEmitter() as InstanceType<typeof EventEmitter> &
        Record<string, unknown>;
      const chunks: Buffer[] = [];
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => {};
      child.stdin = new Writable({
        write(chunk: Buffer, _encoding, callback) {
          chunks.push(chunk);
          callback();
        },
        final(callback) {
          fake.calls.push({ args, input: Buffer.concat(chunks).toString("utf8") });
          callback();
          process.nextTick(() => {
            (child.stdout as InstanceType<typeof EventEmitter>).emit(
              "data",
              Buffer.from(fake.reply),
            );
            child.emit("close", 0);
          });
        },
      });
      return child;
    },
  };
});

vi.mock("../git/git-start-gate", () => ({ hostGitStarts: { enter: async () => {} } }));

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
