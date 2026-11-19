import { z } from "zod";
import { NATIVE_DELIVERY_MAX_BYTES } from "./native-delivery-identity";
import { SafeCounterSchema, WIRE_SHA256_PATTERN, WIRE_UUID_V4_PATTERN } from "./schemas";

const uuid4 = WIRE_UUID_V4_PATTERN;
const epochUuid = z.string().regex(uuid4);
export const NATIVE_DELIVERY_EPOCH_PREFIX = "nd2:";
export const NATIVE_DELIVERY_EPOCH_CAPABILITY = "native.delivery.epochs.v2";
export const NATIVE_DELIVERY_EPOCH_COMPACTION_LIMIT = 32;

export const NativeDeliveryEpochRefSchema = z.strictObject({
  ownerId: epochUuid,
  generation: SafeCounterSchema.min(1),
});
export type NativeDeliveryEpochRef = z.infer<typeof NativeDeliveryEpochRefSchema>;
export const NativeDeliveryEpochFenceSchema = NativeDeliveryEpochRefSchema.extend({
  through: SafeCounterSchema,
  closed: z.boolean(),
});
export type NativeDeliveryEpochFence = z.infer<typeof NativeDeliveryEpochFenceSchema>;
export const NativeDeliveryEpochDescriptionSchema = NativeDeliveryEpochFenceSchema.extend({
  version: z.literal(2),
  openId: epochUuid,
  highWater: SafeCounterSchema,
});
export type NativeDeliveryEpochDescription = z.infer<typeof NativeDeliveryEpochDescriptionSchema>;
export const NativeDeliveryEpochCompactParamsSchema = NativeDeliveryEpochRefSchema.extend({
  expectedThrough: SafeCounterSchema,
  through: SafeCounterSchema,
});

/** Cross-field relationships require owner validation in addition to the
 * losslessly exportable wire shape. Neither is execution authority. */
export function parseNativeDeliveryEpochDescription(
  value: unknown,
): NativeDeliveryEpochDescription {
  const result = NativeDeliveryEpochDescriptionSchema.parse(value);
  if (result.highWater < result.through || (result.closed && result.highWater !== result.through))
    throw new Error("Delivery epoch floor or closed coverage is inconsistent");
  return result;
}

export function parseNativeDeliveryEpochCompactParams(value: unknown) {
  const result = NativeDeliveryEpochCompactParamsSchema.parse(value);
  if (
    result.through < result.expectedThrough ||
    result.through - result.expectedThrough > NATIVE_DELIVERY_EPOCH_COMPACTION_LIMIT
  )
    throw new Error("Delivery epoch compaction exceeds its bounded prefix");
  return result;
}
/** Separately negotiated: old clients never resolve gaps and old Hosts never offer it. */
export const NATIVE_DELIVERY_EPOCH_GAP_CAPABILITY = "native.delivery.epochs.gaps.v1";
export const NATIVE_DELIVERY_EPOCH_GAP_METHOD = "native.delivery.epochs.gap.resolve";
/** The exact missing original, as the producer allocated and offered it. */
export const NativeDeliveryEpochGapParamsSchema = NativeDeliveryEpochRefSchema.extend({
  sequence: SafeCounterSchema.min(1),
  kind: z.enum([
    "buffer",
    "native.services.conversation.desktop.finish",
    "native.services.workspace.format",
  ]),
  sha256: z.string().regex(WIRE_SHA256_PATTERN),
  byteLength: SafeCounterSchema.min(1).max(NATIVE_DELIVERY_MAX_BYTES),
});
export type NativeDeliveryEpochGapParams = z.infer<typeof NativeDeliveryEpochGapParamsSchema>;
/** `not_admitted` is a durable Host witness that this original was never admitted
 * and never can be: no effect, no result and no success. `admitted` means Host
 * retains its receipt; the producer must resolve it through ordinary delivery. */
export const NativeDeliveryEpochGapResultSchema = z.discriminatedUnion("outcome", [
  NativeDeliveryEpochGapParamsSchema.extend({ outcome: z.literal("not_admitted") }),
  NativeDeliveryEpochGapParamsSchema.extend({ outcome: z.literal("admitted") }),
]);
export type NativeDeliveryEpochGapResult = z.infer<typeof NativeDeliveryEpochGapResultSchema>;

export const NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS = {
  [NATIVE_DELIVERY_EPOCH_GAP_METHOD]: {
    params: NativeDeliveryEpochGapParamsSchema,
    result: NativeDeliveryEpochGapResultSchema,
  },
  "native.delivery.epochs.open": {
    params: z.strictObject({ openId: epochUuid }),
    result: NativeDeliveryEpochDescriptionSchema,
  },
  "native.delivery.epochs.status": {
    params: NativeDeliveryEpochRefSchema,
    result: NativeDeliveryEpochDescriptionSchema,
  },
  "native.delivery.epochs.compact": {
    params: NativeDeliveryEpochCompactParamsSchema,
    result: NativeDeliveryEpochDescriptionSchema,
  },
  "native.delivery.epochs.close": {
    params: NativeDeliveryEpochCompactParamsSchema,
    result: NativeDeliveryEpochDescriptionSchema,
  },
} as const;
export type NativeDeliveryEpochMethod = keyof typeof NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS;
export type NativeDeliveryEpochOriginal = NativeDeliveryEpochRef & { sequence: number };

/** A reserved namespace, not authority. Host admission must verify the actual
 * authenticated principal, durable owner/floor and matching SQL metadata. */
export function parseNativeDeliveryEpochOriginalId(id: string): NativeDeliveryEpochOriginal | null {
  if (!id.startsWith(NATIVE_DELIVERY_EPOCH_PREFIX)) return null;
  const parts = id.split(":");
  if (parts.length !== 4 || !uuid4.test(parts[1] ?? ""))
    throw new Error("Native delivery epoch original identity is invalid");
  const counters = parts.slice(2).map((part) => {
    if (!/^[1-9][0-9]{0,15}(?![\s\S])/.test(part))
      throw new Error("Native delivery epoch original counter is invalid");
    const counter = Number(part);
    if (!Number.isSafeInteger(counter) || counter < 1)
      throw new Error("Native delivery epoch original counter is invalid");
    return counter;
  });
  return { ownerId: parts[1]!, generation: counters[0]!, sequence: counters[1]! };
}

export function nativeDeliveryEpochOriginalId(original: NativeDeliveryEpochOriginal): string {
  NativeDeliveryEpochRefSchema.parse({
    ownerId: original.ownerId,
    generation: original.generation,
  });
  SafeCounterSchema.min(1).parse(original.sequence);
  return `${NATIVE_DELIVERY_EPOCH_PREFIX}${original.ownerId}:${original.generation}:${original.sequence}`;
}
