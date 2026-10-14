import { describe, expect, it } from "vitest";
import { deviceBinaryCommand, deviceCommand } from "./device-process";
describe("owned device subprocesses", () => {
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
