import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SendTurnInput } from "../src/integrations/harness/core/types";
import type { ShellResult } from "../src/features/sessions/model/shellRun";
import type { HostProvider } from "./providers";
import { HostEngine, parseCommand } from "./engine";
import { runHostShell } from "./shell";
import type { ShellProfile } from "./shellProfiles";
import { HostStore } from "./store";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "bycoda-shell-test-"));
  const path = join(directory, "host.db");
  const store = new HostStore(path);
  const project = store.addProject(directory, "Test");
  const turns: Array<{ input: SendTurnInput; finish: () => void }> = [];
  const provider: HostProvider = {
    send: vi.fn(
      (input) =>
        new Promise<void>((resolve) => {
          turns.push({ input, finish: resolve });
        }),
    ),
    cancel: vi.fn(async () => turns.at(-1)?.finish()),
    stop: vi.fn(async () => turns.at(-1)?.finish()),
    bind: vi.fn(),
    approve: vi.fn(),
    answer: vi.fn(),
  };
  const runs: Array<{
    cwd: string;
    command: string;
    finish: (result: ShellResult) => void;
  }> = [];
  const shell = (cwd: string, command: string) =>
    new Promise<ShellResult>((finish) => runs.push({ cwd, command, finish }));
  const engine = new HostEngine(store, { codex: provider }, shell);
  const id = engine.command({
    type: "create",
    commandId: "create",
    projectId: project.id,
    harness: "codex",
    model: "codex:test",
    runtimeMode: "supervised",
  }).sessionId;
  cleanups.push(async () => {
    await engine.close();
    try {
      store.close();
    } catch {
      // The restart test closes it itself.
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, path, store, provider, engine, turns, runs, id };
}

const shellBlocks = (store: HostStore, id: string) =>
  store.session(id).session.blocks.filter((block) => block.shell);

describe("a !command on the host", () => {
  it("runs in the session's folder without a model turn and records the output", async () => {
    const { engine, store, provider, runs, id, directory } = setup();
    engine.command({ type: "shell", commandId: "run-1", sessionId: id, line: "git status" });

    expect(runs).toMatchObject([{ command: "git status" }]);
    expect(runs[0].cwd).toBe(store.session(id).session.cwd);
    expect(directory).toBeTruthy();
    expect(shellBlocks(store, id)).toMatchObject([
      { id: "run-1", role: "system", shell: { command: "git status", running: true } },
    ]);
    expect(store.session(id).status).toBe("idle");
    const before = store.session(id).revision;

    runs[0].finish({ output: "clean\n", exitCode: 0, timedOut: false });
    await vi.waitFor(() =>
      expect(shellBlocks(store, id)[0].shell).toEqual({
        command: "git status",
        output: "clean\n",
        exitCode: 0,
      }),
    );
    // A client polling for changes sees the finished block.
    expect(store.session(id).revision).toBeGreaterThan(before);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it("hands the output to the next message, once", async () => {
    const { engine, runs, turns, id } = setup();
    engine.command({ type: "shell", commandId: "run-1", sessionId: id, line: "npm test" });
    runs[0].finish({ output: "1 failed", exitCode: 1, timedOut: false });
    await vi.waitFor(() => expect(runs).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));

    engine.command({ type: "send", commandId: "ask", sessionId: id, text: "Fix it" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    expect(turns[0].input.text).toContain("$ npm test\n1 failed\n[exit code 1]");
    expect(turns[0].input.text.endsWith("Fix it")).toBe(true);
    turns[0].finish();
    await vi.waitFor(() => expect(engine.store.session(id).status).toBe("idle"));

    engine.command({ type: "send", commandId: "again", sessionId: id, text: "Thanks" });
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    expect(turns[1].input.text).toBe("Thanks");
    turns[1].finish();
  });

  it("is accepted while a turn is running and keeps the turn's output", async () => {
    const { engine, store, runs, turns, id } = setup();
    engine.command({ type: "send", commandId: "work", sessionId: id, text: "Work" });
    await vi.waitFor(() => expect(turns).toHaveLength(1));
    turns[0].input.onEvent({ type: "message.delta", text: "Working" });

    engine.command({ type: "shell", commandId: "run-1", sessionId: id, line: "ls" });
    turns[0].input.onEvent({ type: "message.delta", text: " on it" });
    runs[0].finish({ output: "a.txt", exitCode: 0, timedOut: false });
    await vi.waitFor(() => expect(shellBlocks(store, id)[0].shell?.running).toBeUndefined());
    turns[0].finish();
    await vi.waitFor(() => expect(store.session(id).status).toBe("idle"));

    const blocks = store.session(id).session.blocks;
    expect(blocks.find((block) => block.role === "assistant")?.text).toBe("Working on it");
    expect(shellBlocks(store, id)[0].shell).toMatchObject({ output: "a.txt", exitCode: 0 });
  });

  it("marks a command the host did not finish before restarting", async () => {
    const { engine, store, path, id } = setup();
    engine.command({ type: "shell", commandId: "run-1", sessionId: id, line: "sleep 99" });
    await engine.close();
    store.close();

    const reopened = new HostStore(path);
    cleanups.push(() => reopened.close());
    new HostEngine(reopened, {});
    expect(shellBlocks(reopened, id)[0].shell).toEqual({
      command: "sleep 99",
      output: "Host restarted before this command finished.",
      exitCode: null,
    });
  });

  it("rejects an empty or oversized command", () => {
    const base = { type: "shell", commandId: "c", sessionId: "s" };
    expect(() => parseCommand({ ...base, line: "  " })).toThrow();
    expect(() => parseCommand({ ...base, line: "x".repeat(10_001) })).toThrow();
    expect(parseCommand({ ...base, line: "ls -la" })).toEqual({ ...base, line: "ls -la" });
  });
});

describe("runHostShell", () => {
  // Exercise a known shell without inheriting the owner's persisted terminal
  // choice (which may be Git Bash or cmd on Windows).
  const profile: ShellProfile =
    process.platform === "win32"
      ? {
          id: "test-powershell",
          name: "Test PowerShell",
          path: join(
            process.env.SystemRoot ?? "C:\\Windows",
            "System32",
            "WindowsPowerShell",
            "v1.0",
            "powershell.exe",
          ),
          kind: "powershell",
        }
      : { id: "test-sh", name: "Test sh", path: "/bin/sh", kind: "sh" };
  const directory = () => {
    const path = mkdtempSync(join(tmpdir(), "bycoda-shell-run-"));
    cleanups.push(() => rmSync(path, { recursive: true, force: true }));
    return path;
  };

  it("returns what the command printed and its exit code", async () => {
    const result = await runHostShell(directory(), "echo hello", undefined, profile);
    expect(result).toMatchObject({ exitCode: 0, timedOut: false });
    expect(result.output.trim()).toBe("hello");
  });

  it("reports a failing command's exit code", async () => {
    const result = await runHostShell(directory(), "exit 3", undefined, profile);
    expect(result).toMatchObject({ exitCode: 3, timedOut: false });
  });

  it("stops a command that runs past the time limit", async () => {
    const command = process.platform === "win32" ? "Start-Sleep -Seconds 30" : "sleep 30";
    const result = await runHostShell(directory(), command, 500, profile);
    expect(result).toMatchObject({ exitCode: null, timedOut: true });
  }, 20_000);
});

it("abort stops the real command tree before resolving and a retry cannot overlap it", async () => {
  const directory = mkdtempSync(join(tmpdir(), "shell-abort-"));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const output = join(directory, "writes.txt");
  const writer = join(directory, "writer.cjs");
  const launcher = join(directory, "launcher.cjs");
  writeFileSync(
    writer,
    `setInterval(() => require('node:fs').appendFileSync(${JSON.stringify(output)}, 'x'), 20);`,
  );
  writeFileSync(
    launcher,
    `require('node:child_process').spawn(process.execPath, [${JSON.stringify(writer)}], { stdio: 'inherit', windowsHide: true }); setInterval(() => {}, 1000);`,
  );
  const command =
    process.platform === "win32"
      ? `& '${process.execPath.replaceAll("'", "''")}' '${launcher.replaceAll("'", "''")}'`
      : `'${process.execPath}' '${launcher}'`;
  const controller = new AbortController();
  const profile =
    process.platform === "win32"
      ? {
          id: "test",
          name: "PowerShell",
          kind: "powershell",
          path: join(
            process.env.SystemRoot ?? "C:/Windows",
            "System32/WindowsPowerShell/v1.0/powershell.exe",
          ),
        }
      : { id: "test", name: "sh", kind: "sh", path: "/bin/sh" };
  const running = runHostShell(directory, command, 20000, profile, controller.signal);
  try {
    await vi.waitFor(() => expect(existsSync(output)).toBe(true), { timeout: 15000 });
  } finally {
    controller.abort();
  }
  expect((await running).exitCode).toBeNull();
  const stopped = readFileSync(output, "utf8");
  await new Promise((done) => setTimeout(done, 200));
  expect(readFileSync(output, "utf8")).toBe(stopped);
  const retry = runHostShell(directory, command, 20000, profile, controller.signal);
  expect((await retry).exitCode).toBeNull();
  expect(readFileSync(output, "utf8")).toBe(stopped);
}, 30000);
