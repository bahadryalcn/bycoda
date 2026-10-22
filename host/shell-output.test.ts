import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { runHostShell } from "./shell";

vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("./shellProfiles", () => ({
  resolveShellProfile: () => undefined,
}));

afterEach(() => vi.clearAllMocks());

it("preserves UTF-8 characters split across stdout and stderr chunks", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 42,
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const result = runHostShell("/repo", "print");
  const output = "Türkçe 中文 🚀";
  const error = "Hata: ğüş 🧪";
  for (const byte of Buffer.from(output)) child.stdout.write(Buffer.from([byte]));
  for (const byte of Buffer.from(error)) child.stderr.write(Buffer.from([byte]));
  child.emit("close", 0);
  await expect(result).resolves.toEqual({
    output: `${output}\n${error}`,
    exitCode: 0,
    timedOut: false,
  });
});

it("flushes an incomplete final character and retains the output cap", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 42,
    kill: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ReturnType<typeof spawn>);
  const result = runHostShell("/repo", "print");
  child.stdout.write(Buffer.from("x".repeat(600 * 1024)));
  child.stdout.write(Buffer.from([0xe2]));
  child.emit("close", 1);
  const completed = await result;
  expect(completed.output).toHaveLength(512 * 1024);
  expect(completed.output.endsWith("�")).toBe(true);
  expect(completed.exitCode).toBe(1);
});
