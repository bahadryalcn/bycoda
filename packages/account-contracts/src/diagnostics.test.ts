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
      "open C:\\Users\\Dana\\.bycoda-host\\host.log and /home/alice/x and /Users/bob/y",
      { homeDirs: ["C:\\Users\\dana\\"] },
    );
    expect(output).toContain("~\\.bycoda-host\\host.log");
    expect(output).toContain("/home/<user>/x");
    expect(output).toContain("/Users/<user>/y");
    expect(output.toLowerCase()).not.toContain("dana");
  });

  it("replaces given exact values and is idempotent", () => {
    const once = redactDiagnosticText("user Bahadir signed in token=abc123", {
      values: ["bahadir"],
    });
    expect(once).toBe("user <redacted> signed in token=<redacted>");
    expect(redactDiagnosticText(once)).toBe(once);
  });
});

describe("redactDiagnosticText: quoted multi-word secrets", () => {
  it("redacts the whole quoted value and keeps the rest of the line", () => {
    const output = redactDiagnosticText(
      [
        'login password: "correct horse battery" next=ok',
        '{"token": "fake abc def", "user": "visible"}',
        "client_secret='fake two words' mode=on",
        String.raw`payload "{\"password\": \"fake spaced value\", \"id\": 7}"`,
      ].join("\n"),
    );
    for (const leaked of ["correct", "horse", "battery", "abc", "def", "two", "words", "spaced"]) {
      expect(output).not.toContain(leaked);
    }
    expect(output).toContain('password: "<redacted>" next=ok');
    expect(output).toContain('"token": "<redacted>", "user": "visible"');
    expect(output).toContain("client_secret='<redacted>' mode=on");
    expect(output).toContain("id");
    expect(redactDiagnosticText(output)).toBe(output);
  });

  it("redacts an unterminated quoted value through the end of its line only", () => {
    const output = redactDiagnosticText('cut password: "fake first second third\nnext line stays');
    expect(output).toBe('cut password: "<redacted>\nnext line stays');
    expect(redactDiagnosticText(output)).toBe(output);
  });

  it("redacts quoted authorization headers", () => {
    const output = redactDiagnosticText('{"authorization": "Basic fake user pass"}');
    expect(output).not.toContain("fake");
    expect(output).not.toContain("pass");
  });
});

describe("redactDiagnosticText: private key blocks", () => {
  const body = [
    "FAKEKEYBODYFAKEKEYBODYFAKEKEYBODYFAKEKEYBODYFAKEKEYBODYFAKEKEYBODY1234",
    "FAKEKEYBODY==",
  ];
  const block = (label: string, lines = body) =>
    [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`].join("\n");

  it("replaces complete blocks, including indented log continuation lines", () => {
    const output = redactDiagnosticText(
      `before\n${block("RSA PRIVATE KEY")}\nmiddle\n${block(
        "OPENSSH PRIVATE KEY",
        body.map((l) => `  ${l}`),
      )}\nafter`,
    );
    expect(output).toBe("before\n<private-key>\nmiddle\n<private-key>\nafter");
    expect(redactDiagnosticText(output)).toBe(output);
  });

  it("replaces a block written on one line with escaped newlines", () => {
    const output = redactDiagnosticText(
      String.raw`key "-----BEGIN PRIVATE KEY-----\nFAKEKEYBODYFAKE\nFAKEKEYBODY==\n-----END PRIVATE KEY-----\n" done`,
    );
    expect(output).not.toContain("FAKEKEYBODY");
    expect(output).toContain("done");
  });

  it("replaces a PGP private key block", () => {
    const output = redactDiagnosticText(block("PGP PRIVATE KEY BLOCK"));
    expect(output).toBe("<private-key>");
  });

  it("redacts the key material of a block whose END line is missing", () => {
    const output = redactDiagnosticText(
      ["start", "-----BEGIN PRIVATE KEY-----", ...body].join("\n"),
    );
    expect(output).toBe("start\n<private-key>");
  });

  it("stops an unterminated block at the first line that is not key material", () => {
    const output = redactDiagnosticText(
      [
        "-----BEGIN PRIVATE KEY-----",
        ...body,
        "2026-11-09T10:00:00.000Z INFO  [ui] back to normal",
      ].join("\n"),
    );
    expect(output).toBe("<private-key>\n2026-11-09T10:00:00.000Z INFO  [ui] back to normal");
  });

  it("redacts the base64 lines before an END marker whose BEGIN was cut off", () => {
    const output = redactDiagnosticText(
      ["keep this line", ...body, "-----END RSA PRIVATE KEY-----", "after"].join("\n"),
    );
    expect(output).toBe("keep this line\n<private-key>\nafter");
  });

  it("keeps ordinary short lines before an orphan END marker", () => {
    const output = redactDiagnosticText(
      ["done now", "all good", "-----END PRIVATE KEY-----"].join("\n"),
    );
    expect(output).toBe("done now\nall good\n<private-key>");
  });
});

describe("redactDiagnosticText: bounded work", () => {
  const started = () => performance.now();

  it("cuts very long lines and leaves no token fragment at the cut", () => {
    const secret = "ghp_FAKEFAKEFAKEFAKEFAKEFAKE";
    const line = `${"a ".repeat(4080)}${secret} ${"tail ".repeat(200)}`;
    const output = redactDiagnosticText(`${line}\nnext`);
    const [first, second] = output.split("\n");
    expect(first!.length).toBeLessThanOrEqual(8192);
    expect(first!.endsWith("<line-truncated>")).toBe(true);
    expect(output).not.toContain("ghp_");
    expect(output).not.toContain("FAKEFAKE");
    expect(second).toBe("next");
    expect(redactDiagnosticText(output)).toBe(output);
  });

  it("cuts a long run without separators to a marker", () => {
    expect(redactDiagnosticText("A".repeat(50_000))).toBe(" <line-truncated>");
  });

  it("handles pathological over-long lines quickly", () => {
    const shapes = [
      "a".repeat(400_000),
      "a.".repeat(200_000),
      "token".repeat(80_000),
      "sk-".repeat(130_000),
      "x@".repeat(200_000),
      `token${" ".repeat(400_000)}x`,
      `password: "${"\\".repeat(400_000)}`,
    ];
    const start = started();
    for (const shape of shapes)
      redactDiagnosticText(Array.from({ length: 20 }, () => shape).join("\n"));
    expect(performance.now() - start).toBeLessThan(8000);
  });

  it("handles long runs just under the line cap in linear time", () => {
    // A backtracking engine needs billions of steps for these; a linear one well under a second.
    const shapes = [
      "a".repeat(8000),
      "a.".repeat(4000),
      "a-".repeat(4000),
      "token".repeat(1600),
      "sk-".repeat(2600),
      "eyJ".repeat(2600),
      "x@".repeat(4000),
      "a:".repeat(4000),
      `token${" ".repeat(8000)}x`,
      `a=${"b ".repeat(4000)}`,
    ];
    const start = started();
    for (const shape of shapes)
      redactDiagnosticText(Array.from({ length: 200 }, () => shape).join("\n"));
    expect(performance.now() - start).toBeLessThan(8000);
  });

  it("scans a large log of ordinary lines in roughly linear time", () => {
    const line = "2026-11-09T10:00:00.000Z INFO  [host.rpc] call ok method=sessions.list ms=12";
    const text = Array.from({ length: 60_000 }, () => line).join("\n");
    const start = started();
    expect(redactDiagnosticText(text)).toBe(text);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe("composeDiagnosticLog", () => {
  it("redacts only the newest window of a huge section", () => {
    const filler = Array.from({ length: 50_000 }, (_, i) => `old ${i}`).join("\n");
    const start = performance.now();
    const result = composeDiagnosticLog(
      [{ name: "host", text: `${filler}\nlast token=fake-secret-value` }],
      { maxChars: 1000 },
    );
    expect(performance.now() - start).toBeLessThan(5000);
    expect(result.text).toContain("last token=<redacted>");
    expect(result.text).not.toContain("old 0\n");
    expect(result.sources[0]).toMatchObject({ name: "host", truncated: true });
  });

  it("drops the key body when tail cutting removes a BEGIN line (END kept)", () => {
    const body = Array.from({ length: 10 }, () => "FAKEKEYBODY".repeat(6).slice(0, 64));
    const text = [
      "old line",
      "-----BEGIN PRIVATE KEY-----",
      ...body,
      "-----END PRIVATE KEY-----",
      "after one",
      "after two",
    ].join("\n");
    // Window is twice maxChars: 400 chars start inside the body.
    const result = composeDiagnosticLog([{ name: "host", text }], { maxChars: 200 });
    expect(result.text).not.toContain("FAKEKEYBODY");
    expect(result.text).toContain("after two");
    expect(result.sources[0]).toMatchObject({ truncated: true });
  });

  it("drops the key body when tail cutting removes BEGIN and the END is missing", () => {
    const body = Array.from({ length: 20 }, () => "FAKEKEYBODY".repeat(6).slice(0, 64));
    const text = ["old line", "-----BEGIN PRIVATE KEY-----", ...body].join("\n");
    const result = composeDiagnosticLog([{ name: "host", text }], { maxChars: 200 });
    expect(result.text).not.toContain("FAKEKEYBODY");
    expect(result.sources).toEqual([]);
  });

  it("drops leading key body lines of a section the caller already tailed", () => {
    const body = Array.from({ length: 3 }, () => "FAKEKEYBODY".repeat(6).slice(0, 64));
    const result = composeDiagnosticLog([
      { name: "host", text: [...body, "plain line"].join("\n"), truncated: true },
    ]);
    expect(result.text).toBe("===== host =====\nplain line");
  });

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
