import { expect, it } from "vitest";
import { NATIVE_DELIVERY_RPC_SCHEMAS } from "./native-delivery";
import { NativeBufferUploadStartParamsSchema } from "./native-buffer-upload";
import { NativeServiceUploadBeginParamsSchema } from "./native-service-upload";
import { getHostRpcMethod } from "./methods";

const identity = { originalId: "original", sha256: "a".repeat(64), byteLength: 16 * 1024 * 1024 };
it("keeps original16MiB staging capacity without staging double-encoded wrapper bytes", () => {
  expect(
    NativeBufferUploadStartParamsSchema.parse({
      uploadId: "upload",
      byteLength: identity.byteLength,
      sha256: identity.sha256,
      delivery: identity,
    }).delivery,
  ).toEqual(identity);
  expect(
    NativeServiceUploadBeginParamsSchema.parse({
      uploadId: "upload",
      target: "native.services.workspace.format",
      byteLength: identity.byteLength,
      sha256: identity.sha256,
      delivery: identity,
    }).delivery,
  ).toEqual(identity);
  expect(
    NativeBufferUploadStartParamsSchema.safeParse({
      uploadId: "upload",
      byteLength: identity.byteLength + 1,
      sha256: identity.sha256,
      delivery: identity,
    }).success,
  ).toBe(false);
});
it("routes finite private owner delivery and epoch operations with separate capabilities", () => {
  for (const method of Object.keys(NATIVE_DELIVERY_RPC_SCHEMAS)) {
    const descriptor = getHostRpcMethod(method)!;
    expect(descriptor.requiredCapability).toBe(
      method.startsWith("native.delivery.epochs.")
        ? "native.delivery.epochs.v2"
        : method.endsWith(".ack")
          ? method.startsWith("native.buffers.")
            ? "native.buffers.delivery.ack.v1"
            : "native.services.delivery.ack.v1"
          : method.startsWith("native.buffers.")
            ? "native.buffers.delivery.v1"
            : "native.services.delivery.v1",
    );
    expect(descriptor.kind).toBe(
      method.endsWith(".status") || method.endsWith(".result.read") ? "query" : "control",
    );
  }
  expect(
    NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.apply"].params.safeParse({
      ...identity,
      target: "arbitrary.exec",
      paramsJson: "{}",
    }).success,
  ).toBe(false);
  expect(
    NATIVE_DELIVERY_RPC_SCHEMAS["native.buffers.delivery.status"].params.safeParse({
      ...identity,
      owner: "forged",
    }).success,
  ).toBe(false);
});
it("does not make absence a recorded result or grant a finished-handler receipt final requester delivery", () => {
  const schema = NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.status"].result;
  expect(schema.parse({ state: "absent" })).toEqual({ state: "absent" });
  expect(schema.safeParse({ state: "absent", result: { accepted: true } }).success).toBe(false);
  expect(
    schema.safeParse({
      ...identity,
      target: "native.services.conversation.desktop.finish",
      state: "recorded",
      result: { accepted: true },
      requesterDelivered: true,
    }).success,
  ).toBe(false);
  expect(
    schema.safeParse({
      ...identity,
      target: "native.services.conversation.desktop.finish",
      state: "recorded",
      result: { accepted: true },
      resultSource: { sha256: "b".repeat(64), byteLength: 1 },
    }).success,
  ).toBe(false);
  const read = NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.result.read"];
  const params = {
    ...identity,
    target: "native.services.workspace.format",
    resultSource: { sha256: "b".repeat(64), byteLength: 32 * 1024 * 1024 },
    offset: 0,
    limit: 65_536,
  };
  expect(read.params.safeParse(params).success).toBe(true);
  expect(read.params.safeParse({ ...params, limit: 65_537 }).success).toBe(false);
});
it("accepts exact retired tombstones without a retained result or proof", () => {
  const params = { ...identity, consumedResult: { sha256: "c".repeat(64), byteLength: 21 } };
  const ack = NATIVE_DELIVERY_RPC_SCHEMAS["native.buffers.delivery.ack"];
  expect(ack.params.parse(params)).toEqual(params);
  expect(ack.result.parse({ ...params, state: "retired" })).toEqual({
    ...params,
    state: "retired",
  });
  expect(
    ack.result.safeParse({ ...params, state: "retired", result: { acknowledged: true } }).success,
  ).toBe(false);
  expect(ack.params.safeParse({ ...params, principalId: "forged" }).success).toBe(false);
  expect(
    NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.ack"].params.safeParse(params).success,
  ).toBe(false);
});
