import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getHostRpcMethod } from "../../../shared/model/host-contracts";
import { remoteRpcCallLiterals, rpcCallLiterals, rpcDispatchLiterals } from "../../../../scripts/checks/host-rpc-source-fixture.mjs";

// The desktop's native layer forwards only allowlisted host methods
// (`supported_remote_method` in src-tauri/src/remote.rs). A method the app
// calls but the allowlist lacks fails at runtime with "Unsupported remote
// operation", which unit tests that mock `remoteRequest` never see.

const root = join(__dirname, "..", "..", "..", "..");
// This module declares canonical RPC metadata; its method keys are not desktop
// callsites. Exclude only this declaration file, so actual consumers elsewhere
// still reveal missing native forwarding when they start calling a method.
const methodDeclarations = join(root, "src", "shared", "model", "host-contracts", "methods.ts");

function allowlist(): Set<string> {
  const rust = readFileSync(join(root, "src-tauri", "src", "remote.rs"), "utf8");
  const body = rust.match(/fn supported_remote_method[\s\S]*?matches!\(([\s\S]*?)\n\s*\)/);
  if (!body) throw new Error("supported_remote_method not found");
  return new Set([...body[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]));
}

function hostMethods(): Set<string> {
  const server = readFileSync(join(root, "host", "server.ts"), "utf8");
  // Compatibility spellings or tool actions in the HTTP source do not add a
  // canonical RPC contract and must never expand the native forwarding list.
  return new Set(rpcDispatchLiterals(server).filter(name => getHostRpcMethod(name)));
}

// Same spelling as a host method, but not a remote call: an agent tool name
// (agent-app) and a social authorization scope.
const NOT_REMOTE_CALLS = new Set(["notes.list", "inbox.list"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    if (path === methodDeclarations) return [];
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("remote method allowlist", () => {
  it("distinguishes canonical RPC calls from nested operation and schema data", () => {
    const source = `
      assistantRequest({ op: "notes.delete" });
      z.literal("notes.get");
      const reads = ["notes.get"];
      remoteRequest(machineId, "desktop.request", params);
      invoke("remote_request", { method: "tasks.list", params: {} });
      const descriptor = { method: "desktop.status" };
      switch (input.method) { case "tasks.list": break; }
      switch (tool.action) { case "desktop.status": break; }
    `;
    expect(rpcCallLiterals(source).sort()).toEqual(["desktop.request", "tasks.list"]);
    expect(rpcDispatchLiterals(source)).toEqual(["tasks.list"]);
    expect(remoteRpcCallLiterals(source).sort()).toEqual(["desktop.request", "tasks.list"]);
    expect(remoteRpcCallLiterals(`
      import {remoteRequest as send} from "./connections";
      send(machine, "unsupported.real.rpc", {});
      assistantRequest({op: "notes.get"});
      describe({method: "desktop.status"});
    `)).toEqual(["unsupported.real.rpc"]);
    expect(allowlist().has("unsupported.real.rpc")).toBe(false);
    for (const name of ["desktop.status", "desktop.stop"]) {
      expect(getHostRpcMethod(name)).toBeUndefined();
      expect(hostMethods().has(name)).toBe(false);
      expect(allowlist().has(name)).toBe(false);
    }
    expect(getHostRpcMethod("desktop.request")).toBeDefined();
    expect(allowlist().has("desktop.request")).toBe(true);
  });
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
      const source = readFileSync(file, "utf8");
      for (const method of rpcCallLiterals(source, file)) {
        if (served.has(method) && !allowed.has(method) && !NOT_REMOTE_CALLS.has(method))
          missing.add(method);
      }
      // Actual transport calls are checked even when the canonical WS registry
      // has no entry for an existing HTTP method. Never filter these literals.
      for (const method of remoteRpcCallLiterals(source, file)) {
        if (!allowed.has(method)) missing.add(method);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("keeps raw development-server relay operations behind their dedicated native gateway", () => {
    const allowed = allowlist();
    const served = hostMethods();
    for (const action of ["Check", "Open", "Read", "Write", "Close"]) {
      const method = `devServers.bridge${action}`;
      expect(served.has(method), `${method} must remain available to the dedicated gateway`).toBe(
        true,
      );
      expect(allowed.has(method), `${method} must not pass the generic desktop bridge`).toBe(false);
    }
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
      const source = readFileSync(file, "utf8");
      for (const method of rpcCallLiterals(source, file)) {
        if (served.has(method) && !allowed.has(method)) missing.add(method);
      }
      for (const method of remoteRpcCallLiterals(source, file)) {
        if (!allowed.has(method)) missing.add(method);
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
