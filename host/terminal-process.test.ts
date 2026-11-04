import { describe, expect, it } from "vitest";
import { terminalStartupInput } from "./terminal-process";

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
