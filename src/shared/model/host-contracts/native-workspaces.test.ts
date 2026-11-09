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
import {
  NATIVE_BUFFER_UPLOAD_METHODS,
  NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS,
  NATIVE_BUFFER_UPLOAD_LIMITS,
} from "./native-buffer-upload";
import { nativeProfileRecoveryMethod } from "./native-buffer-recovery";

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
    expect(nativeProfileRecoveryMethod(method), method).toBe(false);
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

it("declares exactly the 21 Native workspace methods and preserves separate private ingress predicates", () => {
  expect(NATIVE_WORKSPACE_METHODS).toHaveLength(21);
  for (const method of NATIVE_WORKSPACE_METHODS) {
    const definition = getHostRpcMethod(method)!;
    expect(definition.scope).toBe("device");
    expect(definition.cancellation).toBe(nativeWorkspaceReadOnly(method) ? "query" : "wait-only");
    expect(hostRpcHasEffect(method, definition.kind)).toBe(!nativeWorkspaceReadOnly(method));
    expect(definition.retry).toBe(nativeWorkspaceReadOnly(method) ? "safe-query" : "never");
    expect(nativeDesktopMethod(method)).toBe(method.startsWith("native."));
    expect(nativeProfileRecoveryMethod(method)).toBe(method.startsWith("native.buffers.recovery."));
    expect(exportWireSchema(NATIVE_WORKSPACE_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_WORKSPACE_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  for (const method of [
    "native.future.method",
    "native.turn.begin",
    ...NATIVE_BUFFER_UPLOAD_METHODS,
  ])
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
  for (const method of [...NATIVE_WORKSPACE_METHODS, ...NATIVE_BUFFER_UPLOAD_METHODS]) {
    const definition = getHostRpcMethod(method)!;
    if (!method.startsWith("native.buffers.recovery."))
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

it("validates closed upload envelopes and exports portable bounded byte counters", () => {
  for (const method of NATIVE_BUFFER_UPLOAD_METHODS) {
    expect(getHostRpcMethod(method)!.requiredCapability).toBe("native.buffers.upload.v1");
    expect(getHostRpcMethod(method)!.resultSchema.safeParse(null).success).toBe(
      method === "native.buffers.upload.status",
    );
    expect(exportWireSchema(NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].params)).toBeTruthy();
    expect(exportWireSchema(NATIVE_BUFFER_UPLOAD_RPC_SCHEMAS[method].result)).toBeTruthy();
  }
  const input = {
    uploadId: "upload-a",
    byteLength: NATIVE_BUFFER_UPLOAD_LIMITS.maxBytes,
    sha256: "a".repeat(64),
  };
  expect(parseHostRpcParams("native.buffers.upload.start", input)).toEqual(input);
  for (const invalid of [
    { ...input, byteLength: input.byteLength + 1 },
    { ...input, byteLength: 0 },
    { ...input, ownerId: "forged" },
    { ...input, method: "files.write" },
  ])
    expect(() => parseHostRpcParams("native.buffers.upload.start", invalid)).toThrow();
  expect(() =>
    parseHostRpcParams("native.activity.start", {
      activityId: "a",
      cwd: "/fixture",
      kind: "provider",
      sessionId: null,
    }),
  ).toThrow();
});
