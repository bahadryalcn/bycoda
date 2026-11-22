import { expect, it, vi } from "vitest";
import { execFileAsync, runGitText } from "../src/shared/lib/processExecution.node";
import { GitExecPool } from "./git/git-exec-pool";
import { registerHostProcessExecution } from "./git/host-process-execution";

it("passes argv and environment without shell interpretation and preserves text and binary options", async () => {
  const argument = "literal $HOME & | ;";
  const result = await execFileAsync(
    process.execPath,
    ["-e", "process.stdout.write(process.argv[1]+process.env.AUDIT_VALUE)", argument],
    {
      encoding: "utf8",
      env: { ...process.env, AUDIT_VALUE: " env" },
      windowsHide: true,
    },
  );
  expect(result.stdout).toBe(argument + " env");
  const binary = await execFileAsync(
    process.execPath,
    ["-e", "process.stdout.write(Buffer.from([0,255]))"],
    { encoding: "buffer", windowsHide: true },
  );
  expect(binary.stdout).toEqual(Buffer.from([0, 255]));
});

it("does not trim the git result and preserves the caller's maxBuffer limit", async () => {
  expect(await runGitText(["--version"], { windowsHide: true })).toMatch(/^git version .+\n$/);
  await expect(
    runGitText(["--version"], { windowsHide: true, maxBuffer: 1 }),
  ).rejects.toMatchObject({ code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" });
});

it("routes supported Host calls until disposal and falls back for unsupported options", async () => {
  const pool = new GitExecPool();
  const exec = vi.spyOn(pool, "exec");
  const args = ["-e", "process.stdout.write(require('node:fs').readFileSync(0))"];
  const options = { encoding: "buffer", input: Buffer.from([0, 255]), windowsHide: true } as const;
  const unregister = registerHostProcessExecution(pool);
  try {
    await expect(
      execFileAsync(process.execPath, args, { ...options, lane: "background" }),
    ).resolves.toEqual({ stdout: options.input, stderr: Buffer.alloc(0) });
    expect(exec).toHaveBeenCalledWith(
      process.execPath,
      args,
      expect.objectContaining({
        lane: "background",
        windowsHide: true,
      }),
    );
    await expect(
      execFileAsync(process.execPath, args, { ...options, killSignal: "SIGKILL" }),
    ).resolves.toEqual({ stdout: options.input, stderr: Buffer.alloc(0) });
    expect(exec).toHaveBeenCalledTimes(1);
  } finally {
    unregister();
    await pool.close();
  }
  await expect(execFileAsync(process.execPath, args, options)).resolves.toEqual({
    stdout: options.input,
    stderr: Buffer.alloc(0),
  });
  expect(exec).toHaveBeenCalledTimes(1);
});

it.each([
  {
    file: process.execPath,
    args: ["-e", "console.log('out');console.error('err');process.exit(7)"],
    options: {},
  },
  {
    file: "monocode-missing-executable-for-parity-test",
    args: ["literal argument"],
    options: { encoding: "buffer" },
  },
  {
    file: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    options: { timeout: 500 },
  },
  { file: process.execPath, args: ["-e", "console.log('long output')"], options: { maxBuffer: 1 } },
])("preserves native failure fields for case %#", async ({ file, args, options }) => {
  const readFailure = () =>
    execFileAsync(file, args, options).then(
      () => {
        throw new Error("Expected child failure");
      },
      (error: Record<string, unknown>) =>
        Object.fromEntries(
          ["message", "code", "killed", "signal", "stdout", "stderr", "cmd", "spawnargs"].map(
            (field) => [field, error[field]],
          ),
        ),
    );
  const expected = await readFailure();
  const pool = new GitExecPool();
  const unregister = registerHostProcessExecution(pool);
  try {
    expect(await readFailure()).toEqual(expected);
  } finally {
    unregister();
    await pool.close();
  }
});

it.each(["default", "control"] as const)(
  "dispatches %s work while unrelated lanes are occupied",
  async (lane) => {
    const pool = new GitExecPool(1);
    const unregister = registerHostProcessExecution(pool);
    const blocker = new AbortController();
    const occupiedLane = lane === "control" ? "default" : "background";
    const occupied = execFileAsync(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      lane: occupiedLane,
      signal: blocker.signal,
    }).catch((error: unknown) => error);
    try {
      await expect(
        execFileAsync(process.execPath, ["-e", "console.log('ready')"], { lane, timeout: 1000 }),
      ).resolves.toMatchObject({ stdout: "ready\n" });
    } finally {
      blocker.abort();
      unregister();
      await occupied;
      await pool.close();
    }
  },
);

it("gives queued backend commands a full runtime timeout after launch", async () => {
  const pool = new GitExecPool(1);
  const unregister = registerHostProcessExecution(pool);
  const first = execFileAsync(process.execPath, ["-e", "setTimeout(() => {}, 1200)"]);
  try {
    await expect(
      execFileAsync(process.execPath, ["-e", "console.log('ready')"], { timeout: 1000 }),
    ).resolves.toMatchObject({ stdout: "ready\n" });
  } finally {
    unregister();
    await first;
    await pool.close();
  }
});
