import { describe, expect, it } from "vitest";
import { ACCOUNT_API } from "./api.ts";
import {
  DIAGNOSTIC_TEXT_MAX_CHARS,
  DiagnosticReportCreate,
  composeDiagnosticLog,
  countDiagnosticLevels,
  diagnosticFingerprint,
  formatDiagnosticLine,
  parseDiagnosticLine,
  redactDiagnosticText,
} from "./diagnostics.ts";

const context = {
  appVersion: "0.9.0",
  platform: "windows",
  osVersion: "11",
  channel: "stable",
} as const;
const base = {
  trigger: "crash",
  occurredAt: "2026-11-09T10:00:00.000Z",
  context,
  sources: [{ name: "host", lines: 2, truncated: false }],
  content: { encoding: "gzip-base64", data: "H4sIAAAAAAAAAytJLS4BAAx+f9gEAAAA" },
} as const;

describe("DiagnosticReportCreate (0.9.0)", () => {
  it("accepts only gzip content and rejects extra fields", () => {
    expect(DiagnosticReportCreate.safeParse(base).success).toBe(true);
    expect(
      DiagnosticReportCreate.safeParse({
        ...base,
        content: { encoding: "text", data: "line one\nline two" },
      }).success,
    ).toBe(false);
    expect(DiagnosticReportCreate.safeParse({ ...base, sessionText: "x" }).success).toBe(false);
    expect(
      DiagnosticReportCreate.safeParse({
        ...base,
        content: { encoding: "gzip-base64", data: "not base64!" },
      }).success,
    ).toBe(false);
    expect(DiagnosticReportCreate.safeParse({ ...base, sources: [] }).success).toBe(false);
    expect(
      DiagnosticReportCreate.safeParse({
        ...base,
        sources: [{ name: "Host Log", lines: 1, truncated: false }],
      }).success,
    ).toBe(false);
  });

  it("has a signed-in and an anonymous route", () => {
    expect(ACCOUNT_API.sendDiagnosticReport.auth).toBe("user");
    expect(ACCOUNT_API.sendAnonymousDiagnosticReport.auth).toBe("none");
  });
});

describe("redactDiagnosticText", () => {
  it("removes tokens, keys, emails and credentials", () => {
    const input = [
      "Authorization: Bearer abc.def.ghijklmnop",
      "using key sk-ant-REDACTMEREDACTMEREDACTME",
      "gh token ghp_abcdefghijklmnopqrstuvwxyz0123",
      "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
      'config {"api_key": "hunter2value", "password":"p@ss"}',
      "GET https://api.example.com/cb?code=XYZ123&state=ok",
      "clone https://bob:secretpw@git.example.com/repo.git",
      "contact jane.doe@example.com",
    ].join("\n");
    const output = redactDiagnosticText(input);
    for (const leaked of [
      "abc.def.ghijklmnop",
      "REDACTME",
      "ghp_abcdef",
      "eyJhbGci",
      "hunter2value",
      "p@ss",
      "XYZ123",
      "secretpw",
      "jane.doe@example.com",
    ]) {
      expect(output).not.toContain(leaked);
    }
    expect(output).toContain("state=ok");
  });

  it("replaces home directories and user names in paths", () => {
    const output = redactDiagnosticText(
      "open C:\\Users\\Kraba\\.bycoda-host\\host.log and /home/alice/x and /Users/bob/y",
      { homeDirs: ["C:\\Users\\kraba\\"] },
    );
    expect(output).toContain("~\\.bycoda-host\\host.log");
    expect(output).toContain("/home/<user>/x");
    expect(output).toContain("/Users/<user>/y");
    expect(output.toLowerCase()).not.toContain("kraba");
  });

  it("replaces given exact values and is idempotent", () => {
    const once = redactDiagnosticText("user Bahadir signed in token=abc123", {
      values: ["bahadir"],
    });
    expect(once).toBe("user <redacted> signed in token=<redacted>");
    expect(redactDiagnosticText(once)).toBe(once);
  });
});

describe("composeDiagnosticLog", () => {
  it("joins redacted sections under headers and skips empty or invalid ones", () => {
    const result = composeDiagnosticLog([
      { name: "host", text: "a\nb token=zzz\n" },
      { name: "ui", text: "   " },
      { name: "Bad Name", text: "x" },
      { name: "native", text: "panic", truncated: true },
    ]);
    expect(result.text).toBe("===== host =====\na\nb token=<redacted>\n===== native =====\npanic");
    expect(result.sources).toEqual([
      { name: "host", lines: 2, truncated: false },
      { name: "native", lines: 1, truncated: true },
    ]);
  });

  it("keeps the newest whole lines within the budget", () => {
    const big = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join("\n");
    const result = composeDiagnosticLog(
      [
        { name: "host", text: big },
        { name: "ui", text: "small" },
      ],
      { maxChars: 400 },
    );
    expect(result.text.length).toBeLessThanOrEqual(400);
    expect(result.text).toContain("line 999");
    expect(result.text).not.toContain("line 0\n");
    expect(result.text).toContain("===== ui =====\nsmall");
    expect(result.sources[0]).toMatchObject({ name: "host", truncated: true });
    expect(
      composeDiagnosticLog([{ name: "a", text: "x" }], { maxChars: 10 ** 9 }).text.length,
    ).toBeLessThan(DIAGNOSTIC_TEXT_MAX_CHARS);
  });
});

describe("shared log line format", () => {
  const at = new Date("2026-11-09T10:00:00.000Z");

  it("formats level, category, message and fields and parses them back", () => {
    const line = formatDiagnosticLine(at, "warn", "host.rpc", "slow call", {
      method: "sessions.list",
      ms: 812,
      detail: "two words",
      skipped: undefined,
    });
    expect(line).toBe(
      '2026-11-09T10:00:00.000Z WARN  [host.rpc] slow call method=sessions.list ms=812 detail="two words"',
    );
    expect(parseDiagnosticLine(line)).toEqual({
      at: "2026-11-09T10:00:00.000Z",
      level: "warn",
      category: "host.rpc",
      text: 'slow call method=sessions.list ms=812 detail="two words"',
    });
  });

  it("indents continuation lines and falls back to the app category", () => {
    const line = formatDiagnosticLine(at, "error", "Bad Category", "boom\r\n  at a\nat b\n");
    expect(line).toBe("2026-11-09T10:00:00.000Z ERROR [app] boom\n    at a\n  at b");
    expect(line.split("\n").slice(1).map(parseDiagnosticLine)).toEqual([null, null]);
  });

  it("counts warnings and errors", () => {
    const text = [
      formatDiagnosticLine(at, "info", "ui", "a"),
      formatDiagnosticLine(at, "warn", "ui", "b"),
      formatDiagnosticLine(at, "error", "ui", "c"),
      formatDiagnosticLine(at, "fatal", "ui", "d"),
      "===== host =====",
      "plain legacy line with ERROR in it",
    ].join("\n");
    expect(countDiagnosticLevels(text)).toEqual({ warn: 1, error: 2 });
  });
});

describe("diagnosticFingerprint", () => {
  it("groups the same crash with different volatile parts", () => {
    const a = diagnosticFingerprint(
      "crash",
      String.raw`called unwrap on Err at C:\Users\a\src\x.rs:12 id 0x7ffde1 'abc'`,
    );
    const b = diagnosticFingerprint(
      "crash",
      "called unwrap on Err at /home/b/src/x.rs:98 id 0x1a2b3c 'other'",
    );
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(diagnosticFingerprint("periodic", "called unwrap on Err")).not.toBe(
      diagnosticFingerprint("crash", "called unwrap on Err"),
    );
    expect(diagnosticFingerprint("crash", "  ")).toBeNull();
  });
});
