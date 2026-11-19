import { describe, expect, it } from "vitest";
import {
  EXIT_STDERR_LINE_MAX,
  EXIT_STDERR_LINES,
  providerExitError,
  pushExitStderrTail,
  redactExitStderrLine,
} from "./exitDiagnostics";

describe("pushExitStderrTail", () => {
  it("keeps only the last few non-empty lines", () => {
    const tail: string[] = [];
    for (const line of ["first", "   ", "second", "third", "fourth", ""])
      pushExitStderrTail(tail, line);
    expect(tail).toEqual(["second", "third", "fourth"]);
    expect(tail).toHaveLength(EXIT_STDERR_LINES);
  });

  it("cleans Windows pseudo-terminal output: colors, cursor codes and CRLF", () => {
    const tail: string[] = [];
    pushExitStderrTail(tail, "\u001b[?25l\u001b[31mError:\u001b[0m bad flag\r\n");
    pushExitStderrTail(tail, "\u001b]0;title\u0007second\r");
    expect(tail).toEqual(["Error: bad flag", "second"]);
  });

  it("splits a progress rewrite into lines instead of growing one entry", () => {
    const tail: string[] = [];
    pushExitStderrTail(tail, "10%\r50%\r100%\n");
    expect(tail).toEqual(["10%", "50%", "100%"]);
  });

  it("bounds a very long line", () => {
    const tail: string[] = [];
    pushExitStderrTail(tail, "x".repeat(1_000_000));
    expect(tail).toHaveLength(1);
    expect([...tail[0]].length).toBeLessThanOrEqual(EXIT_STDERR_LINE_MAX);
  });
});

describe("redactExitStderrLine", () => {
  it.each([
    ["Authorization: Bearer abcdef0123456789abcdef", "Authorization: Bearer …"],
    ["Authorization: Basic dXNlcjpwYXNzd29yZA==", "Authorization: Basic …"],
    ["XAI_API_KEY=xai-0123456789abcdef0123456789", "XAI_API_KEY=…"],
    ['{"api_key": "sk-live-0123456789abcdef0123"}', '{"api_key": …}'],
    ["password: hunter2 and more", "password: … and more"],
    [
      "GET https://api.example.com/v1?access_token=abc123&x=1",
      "GET https://api.example.com/v1?access_token=…&x=1",
    ],
    ["proxy https://user:hunter2@proxy.example.com:8080", "proxy https://…@proxy.example.com:8080"],
    ["using sk-proj-0123456789abcdef0123456789", "using …"],
    ["jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP", "jwt …"],
  ])("masks credentials in %j", (raw, masked) => {
    expect(redactExitStderrLine(raw)).toBe(masked);
  });

  it("never leaves the start of a secret behind when it truncates", () => {
    const secret = "sk-live-0123456789abcdef0123456789";
    const line = `${"y".repeat(EXIT_STDERR_LINE_MAX - 10)} key=${secret}`;
    expect(redactExitStderrLine(line)).not.toContain("sk-live");
  });

  it("keeps an ordinary diagnostic readable", () => {
    expect(redactExitStderrLine("Error: unknown flag --foo (exit 2)")).toBe(
      "Error: unknown flag --foo (exit 2)",
    );
    expect(redactExitStderrLine("XAI_API_KEY is not set")).toBe("XAI_API_KEY is not set");
  });
});

describe("providerExitError", () => {
  it("carries the code and the stderr tail", () => {
    expect(providerExitError("Cursor CLI", 3, ["a", "b"]).message).toBe(
      "Cursor CLI exited (exit code 3):\na\nb",
    );
  });

  it("keeps a zero code, and omits the code when the process reports none", () => {
    expect(providerExitError("fx", 0, []).message).toBe("fx exited (exit code 0).");
    expect(providerExitError("fx", null, []).message).toBe("fx exited.");
    expect(providerExitError("fx", undefined, ["boom"]).message).toBe("fx exited:\nboom");
  });
});
