import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as childProcesses from "node:child_process";
import { deviceBinaryCommand, deviceCommand } from "./device-process";
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});
/** A tool that never closes its pipes: only `exit` (or nothing) is ever emitted. */
function stuckChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
  vi.mocked(childProcesses.spawn).mockImplementationOnce(() => child as never);
  return child;
}
describe("owned device subprocesses", () => {
  afterEach(() => vi.useRealTimers());
  it("passes input literally without a shell", async () => {
    const output = await deviceCommand(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      "hello;$(whoami)",
    ]);
    expect(output).toBe("hello;$(whoami)");
  });
  it("terminates hung commands and rejects instead of claiming success", async () => {
    await expect(
      deviceCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], { timeoutMs: 50 }),
    ).rejects.toThrow("timed out");
  });
  it("rejects a timed-out command that never closes, escalating to SIGKILL", async () => {
    vi.useFakeTimers();
    const child = stuckChild();
    const result = deviceCommand("tool", [], { timeoutMs: 100 });
    const assertion = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    expect(child.kill).toHaveBeenCalledWith();
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    expect(child.stdout.destroyed).toBe(true);
  });
  it("settles on exit when a leaked grandchild keeps the pipes open", async () => {
    vi.useFakeTimers();
    const child = stuckChild();
    const result = deviceCommand("tool", [], { timeoutMs: 60_000 });
    child.stdout.write("done");
    child.emit("exit", 0);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(result).resolves.toBe("done");
    expect(child.stdout.destroyed).toBe(true);
  });
  it("keeps diagnostics out of JSON stdout and preserves them on failure", async () => {
    const output = await deviceCommand(process.execPath, [
      "-e",
      'process.stderr.write("runner log\\n"); process.stdout.write(JSON.stringify({success:true}))',
    ]);
    expect(JSON.parse(output)).toEqual({ success: true });
    await expect(
      deviceCommand(process.execPath, [
        "-e",
        'process.stderr.write("SDK unavailable"); process.exitCode=1',
      ]),
    ).rejects.toThrow("SDK unavailable");
  });
  it("rejects output above the cap", async () => {
    await expect(
      deviceCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"]),
    ).rejects.toThrow("1 MiB");
  });
  it("preserves binary screenshot bytes and enforces the binary output cap", async () => {
    const bytes = [137, 80, 78, 71, 13, 10, 26, 10, 255, 0, 128];
    const output = await deviceBinaryCommand(process.execPath, [
      "-e",
      `process.stdout.write(Buffer.from(${JSON.stringify(bytes)}))`,
    ]);
    expect(output).toEqual(Buffer.from(bytes));
    await expect(
      deviceBinaryCommand(process.execPath, [
        "-e",
        "process.stdout.write(Buffer.alloc(5 * 1024 * 1024))",
      ]),
    ).rejects.toThrow("4 MiB");
  });
});
