import { describe, expect, it, vi } from "vitest";
import type { RuntimeLogSource } from "../src/features/host-tools/runtimeLogTypes";
import { RuntimeLogsService, runtimeLogDetails, scrubRuntimeLogText } from "./runtime-logs";

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
  it("redacts serialized sensitive header keys without losing unrelated diagnostics", () => {
    for (const key of [
      "authorization",
      "Proxy-Authorization",
      "COOKIE",
      "set-cookie",
      "credentials",
    ]) {
      const input = JSON.stringify({ [key]: 'synthetic\\opaque"secret', status: 403 });
      const output = scrubRuntimeLogText(input);
      expect(output).not.toContain("synthetic");
      expect(output).toContain('"status":403');
      expect(output).toContain("[REDACTED]");
      const logs = new RuntimeLogsService();
      logs.add(source(), {
        timestamp: 1,
        level: "info",
        message: input,
        stack: input,
        details: input,
      });
      expect(JSON.stringify(logs.read())).not.toContain("synthetic");
    }
  });

  it.each([1, 2, 5])("ignores an old generation cursor when the new cursor is %s", (count) => {
    const old = new RuntimeLogsService();
    append(old, "old one");
    append(old, "old two");
    const before = old.read();
    const fresh = new RuntimeLogsService();
    for (let i = 0; i < count; i++) append(fresh, `fresh ${i}`);
    const after = fresh.read({ after: before.cursor, streamId: before.streamId });
    expect(after.streamId).not.toBe(before.streamId);
    expect(after.entries).toHaveLength(count);
    expect(
      after.entries.some((entry) => before.entries.some((oldEntry) => oldEntry.id === entry.id)),
    ).toBe(false);
  });

  it("uses fixed probes for 500k-property objects without enumerating keys or invoking getters", () => {
    const input: Record<string, unknown> = {};
    for (let i = 0; i < 500_000; i++) input[`field${i}`] = i;
    input.status = 503;
    Object.defineProperty(input, "message", {
      enumerable: true,
      get() {
        throw new Error("getter called");
      },
    });
    let inspected = 0;
    const proxy = new Proxy(input, {
      ownKeys() {
        throw new Error("must not enumerate keys");
      },
      getOwnPropertyDescriptor(target, key) {
        inspected++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    expect(runtimeLogDetails(proxy)).toMatchObject({
      status: 503,
      message: "[getter]",
      $capture: expect.stringContaining("other properties omitted"),
    });
    expect(inspected).toBeLessThan(50);
    expect(
      runtimeLogDetails({
        get message() {
          throw new Error("getter called");
        },
      }),
    ).toMatchObject({ message: "[getter]" });
  });
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
    const details: Record<string, unknown> = { message: "x".repeat(20_000) };
    details.cause = details;
    Object.defineProperty(details, "reason", {
      enumerable: true,
      get: () => {
        throw new Error("must not execute");
      },
    });
    const result = runtimeLogDetails(details);
    expect(JSON.stringify(result).length).toBeLessThan(9000);
    expect(result).toMatchObject({ cause: "[circular]", reason: "[getter]" });
  });

  it("retains common transport diagnostics and explicit custom field/value arrays", () => {
    expect(
      runtimeLogDetails({
        event: "gap",
        route: "checkout",
        method: "POST",
        status: 502,
        stream: "stderr",
        captureGap: true,
        expectedSequence: 3,
        receivedSequence: 8,
        interrupted: true,
      }),
    ).toMatchObject({
      event: "gap",
      route: "checkout",
      method: "POST",
      status: 502,
      stream: "stderr",
      captureGap: true,
      expectedSequence: 3,
      receivedSequence: 8,
      interrupted: true,
    });
    expect(
      runtimeLogDetails([
        ["customField", 123],
        ["api_key", "synthetic-secret"],
      ]),
    ).toEqual([
      ["customField", 123],
      ["api_key", "[REDACTED]"],
    ]);
  });

  it("does not execute array element getters or error name/message/stack getters", () => {
    const getter = vi.fn(() => {
      throw new Error("getter invoked");
    });
    const array = new Array(500_000);
    Object.defineProperty(array, "0", { get: getter });
    expect((runtimeLogDetails(array) as unknown[])[0]).toBe("[getter]");
    const error = new Error("original");
    for (const key of ["name", "message", "stack"])
      Object.defineProperty(error, key, { get: getter });
    expect(runtimeLogDetails(error)).toMatchObject({ name: "[getter]", message: "[getter]" });
    expect(getter).not.toHaveBeenCalled();
    expect(runtimeLogDetails(new TypeError("bad input"))).toMatchObject({
      name: "TypeError",
      message: "bad input",
    });
  });
});
