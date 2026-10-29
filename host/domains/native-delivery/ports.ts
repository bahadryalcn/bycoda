import type { NativeDeliveryMethod } from "../../../src/shared/model/host-contracts/native-delivery";
import type { NativeDeliveryIdentity } from "../../../src/shared/model/host-contracts/native-delivery-identity";

export type NativeBufferDeliveryProof = {
  reportId: string;
  reportVersion: number;
  snapshotDigest: string;
  byteLength: number;
};
export type NativeBufferDeliveryBinding = NativeDeliveryIdentity & {
  principalId: string;
  environmentId: string;
};
export type NativeBufferDeliveryOptions = {
  binding: NativeBufferDeliveryBinding;
  prepared(proof: NativeBufferDeliveryProof): Promise<void>;
};

/** Captured current paired owner; stored data cannot construct this capability. */
export interface NativeDeliveryOwnerPorts {
  call(
    method: NativeDeliveryMethod,
    params: Record<string, unknown>,
    retain: (check: () => Promise<boolean>) => void,
  ): Promise<unknown>;
}
