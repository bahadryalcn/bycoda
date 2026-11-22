import { expect, it } from "vitest";
import {
  getHostRpcMethod,
  hostRpcHasEffect,
  nativeDesktopMethod,
  exportWireSchema,
  parseHostRpcParams,
} from "./index";
import {
  NATIVE_WORKSPACE_METHODS,
  NATIVE_WORKSPACE_RPC_SCHEMAS,
  nativeWorkspaceReadOnly,
} from "./native-workspaces";

it("classifies private development-server gateway ingress independently of generic cleanup and recovery", () => {
  for (const method of [
    "devServers.bridgeCheck",
    "devServers.bridgeOpen",
    "devServers.bridgeRead",
    "devServers.bridgeWrite",
    "devServers.bridgeClose",
    "devServers.bridgeFuture",
  ]) {
    expect(nativeDesktopMethod(method), method).toBe(true);
  }
  for (const method of [
    "workspaces.cleanup.plan",
    "workspaces.cleanup.apply",
    "workspaces.cleanup.status",
    "devServers.list",
    "devServers.openExternal",
    "devServers.restart",
    "devServer.bridgeOpen",
  ])
    expect(nativeDesktopMethod(method), method).toBe(false);
  expect(nativeDesktopMethod("native.future.method")).toBe(true);
});

it("declares exactly the 18 Native workspace methods (four report methods are a stateless shim) and private ingress predicates", () => {
  expect(NATIVE_WORKSPACE_METHODS).toHaveLength(18);
  for (const retired of [
    "native.buffers.recovery.list",
    "native.buffers.recovery.read",
    "native.buffers.recovery.status",
    "native.buffers.upload.start",
    "native.buffers.delivery.apply",
  ])
    expect(getHostRpcMethod(retired), retired).toBeUndefined();
  for (const method of NATIVE_WORKSPACE_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition.scope).toBe("device");
    expect(definition.cancellation).toBe(nativeWorkspaceReadOnly(method) ? "query" : "wait-only");
    expect(hostRpcHasEffect(method, definition.kind)).toBe(!nativeWorkspaceReadOnly(method));
    expect(definition.retry).toBe(nativeWorkspaceReadOnly(method) ? "safe-query" : "never");
    expect(nativeDesktopMethod(method)).toBe(method.startsWith("native."));
    expect(exportWireSchema(NATIVE_WORKSPACE_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_WORKSPACE_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  for (const method of ["native.future.method", "native.turn.begin"])
    expect(nativeDesktopMethod(method)).toBe(true);
  for (const method of [
    "workspaces.cleanup.apply",
    "nativeish.method",
    "goals.final-review.recheck",
    "constructor",
  ])
    expect(nativeDesktopMethod(method)).toBe(false);
});

it("keeps all Native effects on wait-only never-replay policy and the existing30s operation budget", () => {
  for (const method of NATIVE_WORKSPACE_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition.responseTimeoutMs).toBe(30_000);
    expect(definition.cost).toBe("read");
  }
  expect(getHostRpcMethod("native.rewind.status")).toMatchObject({
    kind: "control",
    cancellation: "wait-only",
    retry: "never",
    requiredCapability: "native.workspaces.v1",
  });
  expect(getHostRpcMethod("native.rewind.plan")).toMatchObject({
    kind: "control",
    cancellation: "wait-only",
    retry: "never",
  });
  expect(getHostRpcMethod("workspaces.cleanup.apply")!.requiredCapability).toBe(
    "transport.ws.workspaces.cleanup.v1",
  );
});

it("rejects a malformed native activity start", () => {
  expect(() =>
    parseHostRpcParams("native.activity.start", {
      activityId: "a",
      cwd: "/fixture",
      kind: "provider",
      sessionId: null,
    }),
  ).toThrow();
});
