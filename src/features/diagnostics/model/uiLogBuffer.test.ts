// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import {
  getDiagnosticsConsent,
  getDiagnosticsMode,
  setDiagnosticsMode,
} from "./diagnosticsConsent";
import { createLogBuffer, sourceLocation } from "./uiLogBuffer";

describe("log buffer", () => {
  it("writes lines in the shared format with a category", () => {
    const buffer = createLogBuffer();
    buffer.push("warn", "ui.console", "careful", { n: 2 });
    expect(buffer.snapshot()).toMatch(
      /^\d{4}-\d\d-\d\dT[\d:.]+Z WARN  \[ui\.console\] careful n=2$/,
    );
  });

  it("keeps the newest lines within the line limit", () => {
    const buffer = createLogBuffer({ lines: 3, chars: 10_000 });
    for (let i = 0; i < 5; i++) buffer.push("warn", "ui.console", `m${i}`);
    const lines = buffer.snapshot().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("m2");
  });

  it("drops the oldest lines past the size limit and truncates on a grapheme", () => {
    const buffer = createLogBuffer({ lines: 100, chars: 5000 });
    for (let i = 0; i < 10; i++) buffer.push("error", "ui.error", `${i}${"x".repeat(1000)}`);
    expect(buffer.snapshot().length).toBeLessThanOrEqual(5000);
    buffer.clear();
    buffer.push("error", "ui.error", "😀".repeat(3000));
    expect(buffer.snapshot().includes("�")).toBe(false);
    expect(buffer.snapshot().length).toBeLessThan(5000);
  });

  it("folds identical consecutive lines into a repeat count", () => {
    const buffer = createLogBuffer({ lines: 3, chars: 10_000 });
    for (let i = 0; i < 4; i++) buffer.push("warn", "ui.rpc", "request failed", { method: "a.b" });
    buffer.push("warn", "ui.rpc", "request failed", { method: "c.d" });
    const lines = buffer.snapshot().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/method=a\.b \(repeated 4 times\)$/);
    expect(lines[1]).not.toContain("repeated");
  });
});

describe("source location", () => {
  it("keeps the file name and position, never the directory", () => {
    expect(sourceLocation("http://localhost:1420/assets/app-1a2b.js?x=1", 12, 3)).toBe(
      "app-1a2b.js:12:3",
    );
    expect(sourceLocation("C:\\Users\\ada\\app.js", 5)).toBe("app.js:5");
    expect(sourceLocation(undefined)).toBe("");
  });
});

describe("consent", () => {
  it("treats a missing choice as ask and stores the decision", () => {
    localStorage.clear();
    expect(getDiagnosticsMode()).toBe("ask");
    expect(getDiagnosticsConsent().mode).toBeNull();
    setDiagnosticsMode("auto", () => new Date("2026-11-09T00:00:00Z"));
    expect(getDiagnosticsMode()).toBe("auto");
    expect(getDiagnosticsConsent().decidedAt).toBe("2026-11-09T00:00:00.000Z");
  });
});
