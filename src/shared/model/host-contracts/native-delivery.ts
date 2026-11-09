import { z } from "zod";
import {
  NativeDeliveryIdentitySchema,
  NativeBufferDeliveryRecordedSchema,
  NativeDeliveryResultSourceSchema,
  NativeDeliveryConsumedResultSchema,
} from "./native-delivery-identity";
import { SafeCounterSchema } from "./schemas";
import { NativeServiceUploadTargetSchema } from "./native-service-upload";
import { NATIVE_SERVICES_RPC_SCHEMAS } from "./native-services";
import {
  NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS,
  NativeDeliveryEpochFenceSchema,
  parseNativeDeliveryEpochOriginalId,
} from "./native-delivery-epochs";

export const NativeBufferDeliveryApplyParamsSchema = NativeDeliveryIdentitySchema.extend({
  paramsJson: z.string(),
});
const serviceIdentity = NativeDeliveryIdentitySchema.extend({
  target: NativeServiceUploadTargetSchema,
});
export const NativeServiceDeliveryApplyParamsSchema = serviceIdentity.extend({
  paramsJson: z.string(),
});
const absent = z.strictObject({ state: z.literal("absent") });
const unknown = NativeDeliveryIdentitySchema.extend({ state: z.literal("unknown") });
const fenced = NativeDeliveryIdentitySchema.extend({
  state: z.literal("fenced"),
  epoch: NativeDeliveryEpochFenceSchema,
});
export const nativeDeliveryMatchesEpochFence = (value: z.infer<typeof fenced>) => {
  try {
    const original = parseNativeDeliveryEpochOriginalId(value.originalId);
    return (
      !!original &&
      original.ownerId === value.epoch.ownerId &&
      original.generation === value.epoch.generation &&
      (value.epoch.closed || original.sequence <= value.epoch.through)
    );
  } catch {
    return false;
  }
};
export const NativeBufferDeliveryAckParamsSchema = NativeDeliveryIdentitySchema.extend({
  consumedResult: NativeDeliveryConsumedResultSchema,
});
export const NativeServiceDeliveryAckParamsSchema = serviceIdentity.extend({
  consumedResult: NativeDeliveryConsumedResultSchema,
});
export const NativeBufferDeliveryRetiredSchema = NativeBufferDeliveryAckParamsSchema.extend({
  state: z.literal("retired"),
});
export const NativeServiceDeliveryRetiredSchema = NativeServiceDeliveryAckParamsSchema.extend({
  state: z.literal("retired"),
});
export const NativeBufferDeliveryStatusSchema = z.union([
  absent,
  unknown,
  fenced,
  NativeBufferDeliveryRecordedSchema,
  NativeBufferDeliveryRetiredSchema,
]);
export const NativeServiceDeliveryStatusSchema = z.union([
  absent,
  fenced.extend({ target: NativeServiceUploadTargetSchema }),
  NativeServiceDeliveryRetiredSchema,
  NativeDeliveryIdentitySchema.extend({
    target: z.literal("native.services.workspace.format"),
    state: z.literal("unknown"),
    resultUnavailable: z.literal(true),
  }),
  serviceIdentity.extend({ state: z.literal("unknown") }),
  serviceIdentity.extend({
    state: z.literal("recorded"),
    resultSource: NativeDeliveryResultSourceSchema,
  }),
  NativeDeliveryIdentitySchema.extend({
    state: z.literal("recorded"),
    target: z.literal("native.services.conversation.desktop.finish"),
    result: NATIVE_SERVICES_RPC_SCHEMAS["native.services.conversation.desktop.finish"].result,
  }),
  NativeDeliveryIdentitySchema.extend({
    state: z.literal("recorded"),
    target: z.literal("native.services.workspace.format"),
    result: NATIVE_SERVICES_RPC_SCHEMAS["native.services.workspace.format"].result,
  }),
]);
export const NATIVE_DELIVERY_RPC_SCHEMAS = {
  ...NATIVE_DELIVERY_EPOCH_RPC_SCHEMAS,
  "native.buffers.delivery.ack": {
    params: NativeBufferDeliveryAckParamsSchema,
    result: NativeBufferDeliveryRetiredSchema,
  },
  "native.services.delivery.ack": {
    params: NativeServiceDeliveryAckParamsSchema,
    result: NativeServiceDeliveryRetiredSchema,
  },
  "native.buffers.delivery.apply": {
    params: NativeBufferDeliveryApplyParamsSchema,
    result: NativeBufferDeliveryStatusSchema,
  },
  "native.buffers.delivery.status": {
    params: NativeDeliveryIdentitySchema,
    result: NativeBufferDeliveryStatusSchema,
  },
  "native.services.delivery.apply": {
    params: NativeServiceDeliveryApplyParamsSchema,
    result: NativeServiceDeliveryStatusSchema,
  },
  "native.services.delivery.status": {
    params: serviceIdentity,
    result: NativeServiceDeliveryStatusSchema,
  },
  "native.services.delivery.result.read": {
    params: serviceIdentity.extend({
      resultSource: NativeDeliveryResultSourceSchema,
      offset: SafeCounterSchema,
      limit: SafeCounterSchema.min(1).max(65_536),
    }),
    result: serviceIdentity.extend({
      resultSource: NativeDeliveryResultSourceSchema,
      offset: SafeCounterSchema,
      data: z.string(),
    }),
  },
} as const;
export type NativeDeliveryMethod = keyof typeof NATIVE_DELIVERY_RPC_SCHEMAS;
export type NativeBufferDeliveryStatus = z.infer<typeof NativeBufferDeliveryStatusSchema>;
export type NativeServiceDeliveryStatus = z.infer<typeof NativeServiceDeliveryStatusSchema>;
export const NATIVE_DELIVERY_METHODS = Object.freeze(
  Object.keys(NATIVE_DELIVERY_RPC_SCHEMAS) as NativeDeliveryMethod[],
);
