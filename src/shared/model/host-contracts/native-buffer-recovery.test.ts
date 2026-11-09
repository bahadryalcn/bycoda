import { expect, it } from "vitest";
import { getHostRpcMethod, parseHostRpcParams } from "./methods";
import {
  NativeBufferRecoveryStatusSchema,
  nativeProfileRecoveryMethod,
} from "./native-buffer-recovery";

it("registers only closed, device-authenticated recovery queries with ordinary read budgets", () => {
  for (const action of ["list", "read", "status"]) {
    const method = `native.buffers.recovery.${action}`;
    expect(nativeProfileRecoveryMethod(method)).toBe(true);
    expect(getHostRpcMethod(method)).toMatchObject({
      kind: "query",
      scope: "device",
      retry: "safe-query",
      cancellation: "query",
      cost: "read",
      requiredCapability: "native.buffers.recovery.v1",
    });
  }
  expect(nativeProfileRecoveryMethod("native.buffers.recovery.resolve")).toBe(false);
  expect(() =>
    parseHostRpcParams("native.buffers.recovery.list", { endpoint: "http://elsewhere" }),
  ).toThrow();
  expect(() => parseHostRpcParams("native.buffers.recovery.list", { limit: 101 })).toThrow();
});
it("preserves exact five-field locators and cannot decode qualification or disposition claims", () => {
  const source = {
    reportId: "a".repeat(64),
    reportVersion: 0,
    ownerId: "legacy-owner",
    ownerVersion: 0,
    snapshotDigest: "b".repeat(64),
  };
  expect(parseHostRpcParams("native.buffers.recovery.read", source)).toEqual(source);
  expect(() =>
    parseHostRpcParams("native.buffers.recovery.read", { ...source, path: "/arbitrary" }),
  ).toThrow();
  expect(() =>
    parseHostRpcParams("native.buffers.recovery.read", {
      ...source,
      ownerVersion: Number.MAX_SAFE_INTEGER + 1,
    }),
  ).toThrow();
  expect(
    NativeBufferRecoveryStatusSchema.safeParse({
      version: 1,
      qualified: true,
      source,
      found: true,
      inspectable: true,
      resolution: "resolved",
    }).success,
  ).toBe(false);
});
