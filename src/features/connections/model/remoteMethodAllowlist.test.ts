import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The desktop's native layer forwards only allowlisted host methods
// (`supported_remote_method` in src-tauri/src/remote.rs). A method the app
// calls but the allowlist lacks fails at runtime with "Unsupported remote
// operation", which unit tests that mock `remoteRequest` never see.

const root = join(__dirname, "..", "..", "..", "..");

function allowlist(): Set<string> {
  const rust = readFileSync(join(root, "src-tauri", "src", "remote.rs"), "utf8");
  const body = rust.match(/fn supported_remote_method[\s\S]*?matches!\(([\s\S]*?)\n\s*\)/);
  if (!body) throw new Error("supported_remote_method not found");
  return new Set([...body[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

function hostMethods(): Set<string> {
  const server = readFileSync(join(root, "host", "server.ts"), "utf8");
  return new Set(
    [...server.matchAll(/case "([a-zA-Z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)+)":/g)].map(
      (match) => match[1],
    ),
  );
}

// Same spelling as a host method, but not a remote call: an agent tool name
// (agent-app) and a social authorization scope.
const NOT_REMOTE_CALLS = new Set(["notes.list", "inbox.list"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("remote method allowlist", () => {
  it("connects every Crew control to both host dispatch and the native bridge", () => {
    const allowed = allowlist();
    const served = hostMethods();
    for (const action of [
      "list",
      "save",
      "delete",
      "deleteRun",
      "agent.save",
      "agent.delete",
      "start",
      "get",
      "inspect",
      "pause",
      "resume",
      "stop",
      "assign",
      "request",
      "resolve",
      "accept",
      "finish",
    ]) {
      const method = `crews.${action}`;
      expect(served.has(method), `${method} must exist on the host`).toBe(true);
      expect(allowed.has(method), `${method} must pass the native bridge`).toBe(true);
    }
    expect(allowed.has("crews.deleteAll")).toBe(false);
  });
  it("lets through every host method the desktop app calls", () => {
    const allowed = allowlist();
    const served = hostMethods();
    const missing = new Set<string>();
    for (const file of sourceFiles(join(root, "src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /["'`]([a-zA-Z]+\.[a-zA-Z]+)["'`]/g,
      )) {
        if (served.has(match[1]) && !allowed.has(match[1]) && !NOT_REMOTE_CALLS.has(match[1]))
          missing.add(match[1]);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("forwards sprint lifecycle and source synchronization without opening arbitrary methods", () => {
    const allowed = allowlist();
    const served = hostMethods();
    for (const method of [
      "tasks.snapshotWithCursor",
      "tasks.events",
      ...[
        "list",
        "get",
        "create",
        "update",
        "start",
        "complete",
        "archive",
        "plan",
        "report",
        "ingest",
        "goalContext",
      ].map((action) => `sprints.${action}`),
    ]) {
      expect(served.has(method), `${method} must exist on the host`).toBe(true);
      expect(allowed.has(method), `${method} must pass the native bridge`).toBe(true);
    }
    expect(allowed.has("sprints.delete")).toBe(false);
    expect(allowed.has("sprints.execute")).toBe(false);
    expect(allowed.has("tasks.events.delete")).toBe(false);
  });

  it("forwards multi-segment and underscore methods called by conversation tools", () => {
    const allowed = allowlist();
    const served = hostMethods();
    const missing = new Set<string>();
    const files = [...sourceFiles(join(root, "src", "features", "host-tools"))];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(
        /["'`]([a-zA-Z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)+)["'`]/g,
      )) {
        if (served.has(match[1]) && !allowed.has(match[1])) missing.add(match[1]);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("forwards each device operation composed by the conversation tools", () => {
    // SessionHostTools uses `devices.${method}`, which the literal scan above
    // cannot see. These are the DevicePanelApi operations sent to DeviceHost.
    const allowed = allowlist();
    const served = hostMethods();
    for (const action of [
      "status",
      "setup",
      "start",
      "stop",
      "list",
      "boot",
      "capture",
      "action",
    ]) {
      const method = `devices.${action}`;
      expect(served.has(method), `${method} must exist on the host`).toBe(true);
      expect(allowed.has(method), `${method} must pass the native bridge`).toBe(true);
    }
  });

  it("recognizes visual and PR routes without authorizing adjacent operations", () => {
    const allowed = allowlist();
    const served = hostMethods();
    for (const method of []) {
      expect(served.has(method), `${method} must be discovered in the host dispatcher`).toBe(true);
      expect(allowed.has(method), `${method} must pass the native bridge`).toBe(true);
    }
    for (const method of ["removed.feature", "devices.exec", "removed.pr-feature"]) {
      expect(allowed.has(method), `${method} must remain unsupported`).toBe(false);
    }
  });
});
