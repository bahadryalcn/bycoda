import { describe, expect, it } from "vitest";
import type { RuntimeLogSource } from "../src/features/host-tools/runtimeLogTypes";
import { RuntimeLogsService, runtimeLogDetails } from "./runtime-logs";

const source = (
  id = "a",
  projectId = "project-a",
  sessionId?: string,
  kind: "browser" | "server" = "browser",
): RuntimeLogSource => ({
  id,
  kind,
  label: id,
  projectId,
  sessionId,
  available: true,
});
const append = (
  logs: RuntimeLogsService,
  message: string,
  from = source(),
  level: "info" | "error" = "info",
) => logs.add(from, { timestamp: 100, level, message });

describe("bounded host runtime logs", () => {
  it("paginates incrementally without skipping matching entries and reports retention drops", () => {
    const logs = new RuntimeLogsService({ maxEntries: 3 });
    for (const message of ["old", "first", "second", "third"]) append(logs, message);
    const first = logs.read({ after: 0, limit: 2 });
    expect(first.entries.map((entry) => entry.message)).toEqual(["first", "second"]);
    expect(first).toMatchObject({ cursor: 3, dropped: 1 });
    const second = logs.read({ after: first.cursor, limit: 2 });
    expect(second.entries.map((entry) => entry.message)).toEqual(["third"]);
    expect(second.cursor).toBe(4);
    expect(logs.read({ limit: 1 }).entries[0].message).toBe("third");
    expect(logs.read({ after: second.cursor }).entries).toEqual([]);
  });

  it("isolates projects and browser sessions but includes project-level server events", () => {
    const logs = new RuntimeLogsService();
    append(logs, "selected browser", source("a", "project-a", "session-a"));
    append(logs, "other session", source("b", "project-a", "session-b"));
    append(logs, "selected server", source("c", "project-a", undefined, "server"));
    append(logs, "other project", source("d", "project-b", "session-a"));
    append(logs, "unattributed browser", {
      id: "unattributed",
      kind: "browser",
      label: "host browser",
      available: true,
    });
    const selected = logs.read({ projectId: "project-a", sessionId: "session-a" });
    expect(selected.entries.map((entry) => entry.message)).toEqual([
      "selected browser",
      "selected server",
    ]);
    expect(selected.sources.map((item) => item.id)).toEqual(["a", "c"]);
    const forged = logs.add(
      { id: "host", kind: "browser", label: "host", available: true },
      {
        timestamp: 100,
        level: "info",
        message: "cannot retag",
        projectId: "project-a",
        sessionId: "session-a",
      },
    );
    expect(forged.projectId).toBeUndefined();
    expect(logs.read({ projectId: "project-a", sessionId: "session-a" }).entries).toHaveLength(2);
  });

  it("filters details, source and severity, and clears only the selected scope", () => {
    const logs = new RuntimeLogsService();
    append(logs, "ordinary", source());
    logs.add(source(), {
      timestamp: 1,
      level: "error",
      message: "failed",
      details: { route: "checkout" },
    });
    append(logs, "other", source("b", "project-b"), "error");
    expect(
      logs
        .read({ sourceId: "a", levels: ["error"], search: "CHECKOUT" })
        .entries.map((entry) => entry.message),
    ).toEqual(["failed"]);
    logs.clear({ projectId: "project-a", levels: ["error"] });
    expect(logs.read().entries.map((entry) => entry.message)).toEqual(["ordinary", "other"]);
    expect(logs.read().cursor).toBe(3);
  });

  it("bounds sources and bytes while preserving unavailable external source reasons", () => {
    const logs = new RuntimeLogsService({ maxSources: 2, maxBytes: 1024 });
    append(logs, "first", source("first"));
    logs.setSource({
      ...source("external", "project-a", undefined, "server"),
      available: false,
      reason: "Started outside bycoda; historical output unavailable.",
    });
    append(logs, "next", source("next"));
    expect(logs.sources().map((item) => item.id)).toEqual(["first", "next"]);
    append(logs, "x".repeat(5000), source("next"));
    expect(logs.read().entries).toEqual([]);
    expect(logs.read().dropped).toBe(3);
    const observed = new RuntimeLogsService();
    observed.setSource({
      ...source("external", "project-a", undefined, "server"),
      available: false,
      reason: "Historical output unavailable.",
    });
    expect(observed.read()).toMatchObject({
      entries: [],
      sources: [{ available: false, reason: "Historical output unavailable." }],
    });
  });

  it("redacts credentials before retaining objects, URLs, stacks or strings and returns independent copies", () => {
    const logs = new RuntimeLogsService();
    const from = { ...source(), url: "https://app.test/?access_token=source-secret" };
    logs.add(from, {
      timestamp: 100,
      level: "error",
      message:
        "token=secret-value password=hidden-value Bearer abcdef1234 https://user:pass@host.test/path",
      details: {
        authorization: "secret",
        nested: { apiKey: "api-value", refreshToken: "refresh-value", count: 2 },
      },
      stack: "Error: https://app.test/?token=stack-secret",
      location: { file: "https://app.test/path?password=file-secret" },
    });
    const serialized = JSON.stringify(logs.read());
    for (const secret of [
      "source-secret",
      "secret-value",
      "hidden-value",
      "abcdef1234",
      "user:pass",
      "api-value",
      "refresh-value",
      "stack-secret",
      "file-secret",
    ])
      expect(serialized).not.toContain(secret);
    expect(serialized).toContain("[REDACTED]");
    const read = logs.read();
    read.entries[0].message = "mutated";
    read.sources[0].label = "mutated";
    expect(logs.read().entries[0].message).not.toBe("mutated");
    expect(logs.sources()[0].label).toBe("a");
  });

  it("limits nested values and never invokes application getters", () => {
    const details: Record<string, unknown> = { text: "x".repeat(20_000) };
    details.self = details;
    Object.defineProperty(details, "getter", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    const result = runtimeLogDetails(details);
    expect(JSON.stringify(result).length).toBeLessThan(9000);
    expect(result).toMatchObject({ self: "[circular]", getter: "[getter]" });
  });
});
