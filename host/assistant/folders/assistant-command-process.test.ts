import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { commandEnvironment, startCommand } from "./assistant-command-process";

const node = (code: string, timeoutMs = 20_000, tailBytes?: number) =>
  startCommand(
    { command: process.execPath, args: ["-e", code], cwd: tmpdir(), timeoutMs },
    tailBytes ? { tailBytes } : {},
  );

describe("startCommand", () => {
  it("reports the exit code, stdout and stderr of a finished process", async () => {
    const result = await node(
      'process.stdout.write("out"); process.stderr.write("err"); process.exit(3)',
    ).done;
    expect(result).toMatchObject({
      status: "completed",
      exitCode: 3,
      stdout: "out",
      stderr: "err",
      stdoutTruncated: false,
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps only the tail of large output and says so", async () => {
    const result = await node(
      'process.stdout.write("a".repeat(5000) + "END"); process.stderr.write("b".repeat(300))',
      20_000,
      1000,
    ).done;
    expect(result.stdout.length).toBe(1000);
    expect(result.stdout.endsWith("END")).toBe(true);
    expect(result.stdoutTruncated).toBe(true);
    expect(result.stderrTruncated).toBe(false);
  });

  it("decodes invalid UTF-8 lossily instead of stopping", async () => {
    const result = await node(
      'process.stdout.write(Buffer.from([0x68, 0xff, 0xfe, 0x69, 0x0a])); process.stdout.write("after")',
    ).done;
    expect(result.status).toBe("completed");
    expect(result.stdout).toContain("h");
    expect(result.stdout).toContain("i");
    expect(result.stdout.endsWith("after")).toBe(true);
  });

  it("stops the process at its deadline", async () => {
    const result = await node("setInterval(() => {}, 1000)", 300).done;
    expect(result.status).toBe("timed-out");
    expect(result.exitCode).toBeNull();
    expect(result.error).toMatch(/deadline/);
  });

  it("cancels a running process", async () => {
    const run = node("setInterval(() => {}, 1000)");
    expect(run.snapshot().status).toBe("running");
    run.cancel();
    const result = await run.done;
    expect(result.status).toBe("cancelled");
    expect(run.snapshot().status).toBe("cancelled");
  });

  it("reports a process that cannot start and never rejects", async () => {
    const result = await startCommand({
      command: "definitely-not-a-real-command-xyz",
      args: [],
      cwd: tmpdir(),
      timeoutMs: 5000,
    }).done;
    expect(result.status).toBe("failed");
    expect(result.exitCode).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it("does not use a shell when args are given", async () => {
    const result = await node('process.stdout.write(process.argv.slice(1).join("|"))').done;
    expect(result.exitCode).toBe(0);
    const metachars = await startCommand({
      command: process.execPath,
      args: ["-e", "process.stdout.write(process.argv.slice(1).join('|'))", "a;b", "$HOME", "&& x"],
      cwd: tmpdir(),
      timeoutMs: 20_000,
    }).done;
    expect(metachars.stdout).toBe("a;b|$HOME|&& x");
  });

  it("runs a single command line through the platform shell when no args are given", async () => {
    const result = await startCommand({
      command: "echo shell-ok",
      cwd: tmpdir(),
      timeoutMs: 30_000,
    }).done;
    expect(result.stdout).toContain("shell-ok");
    expect(result.exitCode).toBe(0);
  });

  it("does not pass Host credentials to the process", async () => {
    expect(
      commandEnvironment({
        PATH: "/bin",
        GH_TOKEN: "x",
        MY_API_KEY: "y",
        DB_PASSWORD: "z",
        HOME: "/h",
      }),
    ).toEqual({ PATH: "/bin", HOME: "/h" });
    process.env.ASSISTANT_TEST_SECRET = "leak";
    try {
      const result = await node("process.stdout.write(String(process.env.ASSISTANT_TEST_SECRET))")
        .done;
      expect(result.stdout).toBe("undefined");
    } finally {
      delete process.env.ASSISTANT_TEST_SECRET;
    }
  });
});
