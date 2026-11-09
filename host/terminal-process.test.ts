import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ child: undefined as unknown }));
vi.mock("node:child_process", () => ({ spawn: () => fixture.child }));
import { startTerminalProcess, terminalStartupInput } from "./terminal-process";

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
