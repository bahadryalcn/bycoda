import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", () => ({ spawn: () => fixture.child }));
import {
  startTerminalProcess,
  terminalStartupInput,
  terminalCommandArgs,
} from "./terminal-process";

describe("one-shot terminal arguments", () => {
  it.each(["pwsh", "powershell"])("passes PowerShell source as one argv for %s", (kind) => {
    const command = "Write-Output 'hello'\nexit 7";
    expect(terminalCommandArgs(kind, command, "linux")).toEqual([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command,
    ]);
  });
  it.each(["sh", "bash", "zsh"])("passes POSIX source unchanged for %s", (kind) => {
    const command = "printf '%s' \"hello\"\nexit 7";
    expect(terminalCommandArgs(kind, command, "linux")).toEqual(["-c", command]);
  });
  it("rejects cmd command mode and other unsupported shells without changing source", () => {
    expect(() => terminalCommandArgs("cmd", "echo hello\nexit 7")).toThrow("unsupported");
    expect(() => terminalCommandArgs("unknown", "echo hello")).toThrow("unsupported");
  });
});

describe("terminal startup input", () => {
  it("switches Windows cmd and PowerShell to UTF-8 before the first user line", () => {
    expect(terminalStartupInput("cmd", "win32")).toBe("chcp 65001>nul\r\n");
    expect(terminalStartupInput("powershell", "win32")).toMatch(
      /^\[Console\]::InputEncoding=.*\$OutputEncoding=\[Console\]::OutputEncoding\r\n$/,
    );
    expect(terminalStartupInput("pwsh", "win32")).toMatch(/\r\n$/);
  });
  it("writes nothing on other platforms and for other shells", () => {
    expect(terminalStartupInput("cmd", "linux")).toBe("");
    expect(terminalStartupInput("pwsh", "darwin")).toBe("");
    expect(terminalStartupInput("zsh", "linux")).toBe("");
    expect(terminalStartupInput("bash", "win32")).toBe("");
  });
});

it("does not report physical exit on child error until close", async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdio: [null, null, null, new PassThrough()],
  });
  fixture.child = child;
  const exited = vi.fn();
  const process = startTerminalProcess(
    { id: "sh", name: "Shell", path: "/fake", kind: "sh" },
    "/fake",
    () => {},
    exited,
  );
  child.emit("error", new Error("uncertain"));
  expect(exited).not.toHaveBeenCalled();
  const stopped = process.stop();
  child.emit("close", 0);
  await stopped;
  expect(exited).toHaveBeenCalledOnce();
});

it("closes a command watchdog on private child-exit proof but waits for drained guardian exit", () => {
  const watchdog = new PassThrough();
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdio: [null, null, null, watchdog],
  });
  fixture.child = child;
  const events: unknown[] = [];
  startTerminalProcess(
    { id: "sh", name: "Shell", path: "/fake", kind: "sh" },
    "/fake",
    (data) => {
      if (data) events.push(data);
    },
    (code) => events.push(code),
    "echo hello",
  );
  child.emit("message", { type: "unrelated" });
  expect(watchdog.writableEnded).toBe(false);
  child.stdout.write(Buffer.from([0xc3]));
  child.emit("message", { type: "child-exited" });
  expect(watchdog.writableEnded).toBe(true);
  expect(events).toEqual([]);
  child.stdout.write(Buffer.from([0xa7]));
  child.emit("close", 7);
  expect(events).toEqual(["ç", 7]);
});
