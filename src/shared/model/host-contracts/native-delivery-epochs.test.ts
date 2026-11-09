import { expect, it } from "vitest";
import {
  NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS,
  NativeDeliveryEpochDescriptionSchema,
  parseNativeDeliveryEpochDescription,
  parseNativeDeliveryEpochCompactParams,
  nativeDeliveryEpochOriginalId,
  parseNativeDeliveryEpochOriginalId,
} from "./native-delivery-epochs";
import { NATIVE_DELIVERY_RPC_SCHEMAS, nativeDeliveryMatchesEpochFence } from "./native-delivery";

const ref = { ownerId: "ec966798-c70e-4b9a-bf38-af3d20e1c915", generation: 1 };
const openId = "1a0884c3-75c3-4c2e-8579-448b7eed72ac";
const description = { ...ref, version: 2, openId, through: 0, highWater: 0, closed: false };

it("round-trips the reserved original namespace without accepting decimal or UUID aliases", () => {
  for (const generation of [1, Number.MAX_SAFE_INTEGER]) {
    for (const sequence of [1, Number.MAX_SAFE_INTEGER]) {
      const original = { ...ref, generation, sequence };
      expect(parseNativeDeliveryEpochOriginalId(nativeDeliveryEpochOriginalId(original))).toEqual(
        original,
      );
    }
  }
  expect(parseNativeDeliveryEpochOriginalId("legacy-original")).toBeNull();
  const canonical = nativeDeliveryEpochOriginalId({ ...ref, sequence: 1 });
  for (const invalid of [
    canonical + "\n",
    canonical + ":extra",
    `nd2:${ref.ownerId}:01:1`,
    `nd2:${ref.ownerId}:1:01`,
    `nd2:${ref.ownerId}:1:0`,
    `nd2:${ref.ownerId}:1:1.0`,
    `nd2:${ref.ownerId}:1:1e0`,
    `nd2:${ref.ownerId}:1:9007199254740992`,
    `nd2:${ref.ownerId}:9007199254740992:1`,
    `nd2:${ref.ownerId.toUpperCase()}:1:1`,
    `nd2:${ref.ownerId.replace("-4b9a-", "-5b9a-")}:1:1`,
    `nd2:${ref.ownerId}\n:1:1`,
  ])
    expect(() => parseNativeDeliveryEpochOriginalId(invalid), invalid).toThrow();
  expect(() => nativeDeliveryEpochOriginalId({ ...ref, sequence: 0 })).toThrow();
});

it("requires exact epoch DTOs and bounded, nonregressing compaction requests", () => {
  expect(NativeDeliveryEpochDescriptionSchema.parse(description)).toEqual(description);
  for (const invalid of [
    { ...description, version: 1 },
    { ...description, openId: openId + "\n" },
    { ...description, through: 1 },
    { ...description, highWater: 1, closed: true },
    { ...description, authority: true },
  ])
    expect(() => parseNativeDeliveryEpochDescription(invalid)).toThrow();
  const compact = NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS["native.delivery.epochs.compact"].params;
  expect(compact.parse({ ...ref, expectedThrough: 0, through: 32 }).through).toBe(32);
  expect(compact.parse({ ...ref, expectedThrough: 32, through: 32 }).through).toBe(32);
  for (const invalid of [
    { ...ref, expectedThrough: 0, through: 33 },
    { ...ref, expectedThrough: 2, through: 1 },
    { ...ref, expectedThrough: 0, through: 1, principalId: "forged" },
    { ...ref, generation: 0, expectedThrough: 0, through: 1 },
  ])
    expect(() => parseNativeDeliveryEpochCompactParams(invalid)).toThrow();
  expect(
    NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS["native.delivery.epochs.open"].params.safeParse({
      openId,
      ownerId: ref.ownerId,
    }).success,
  ).toBe(false);
});

it("reports only matching covered originals as fenced and never fabricates result or consumption", () => {
  const identity = {
    originalId: nativeDeliveryEpochOriginalId({ ...ref, sequence: 2 }),
    sha256: "a".repeat(64),
    byteLength: 2,
  };
  const fenced = { ...identity, state: "fenced", epoch: { ...ref, through: 2, closed: false } };
  const buffer = NATIVE_DELIVERY_RPC_SCHEMAS["native.buffers.delivery.status"].result;
  const service = NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.status"].result;
  expect(buffer.parse(fenced)).toEqual(fenced);
  expect(service.parse({ ...fenced, target: "native.services.workspace.format" })).toMatchObject(
    fenced,
  );
  for (const invalid of [
    { ...fenced, originalId: "legacy-original" },
    { ...fenced, epoch: { ...fenced.epoch, generation: 2 } },
    { ...fenced, epoch: { ...fenced.epoch, through: 1 } },
  ])
    expect(nativeDeliveryMatchesEpochFence(invalid)).toBe(false);
  for (const invalid of [
    { ...fenced, result: { acknowledged: true } },
    { ...fenced, consumedResult: { sha256: "b".repeat(64), byteLength: 21 } },
  ])
    expect(buffer.safeParse(invalid).success).toBe(false);
  expect(
    buffer.parse({ ...fenced, epoch: { ...fenced.epoch, through: 0, closed: true } }),
  ).toMatchObject({ state: "fenced" });
  expect(
    NATIVE_DELIVERY_RPC_SCHEMAS["native.buffers.delivery.ack"].result.safeParse(fenced).success,
  ).toBe(false);
  expect(
    NATIVE_DELIVERY_RPC_SCHEMAS["native.services.delivery.ack"].result.safeParse({
      ...fenced,
      target: "native.services.workspace.format",
    }).success,
  ).toBe(false);
});
