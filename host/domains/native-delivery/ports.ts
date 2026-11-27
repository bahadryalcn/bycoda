import type { NativeDeliveryMethod } from "../../../src/shared/model/host-contracts/native-delivery";

/** The request's original ingress deadline: a `monotonicNow()` instant counted from receipt,
 * so time spent queued behind other Host work is already spent. */
export type NativeDeliveryIngress = { admitBefore?: number };

/** Captured current paired owner; stored data cannot construct this capability. */
export interface NativeDeliveryOwnerPorts {
  call(
    method: NativeDeliveryMethod,
    params: Record<string, unknown>,
    retain: (check: () => Promise<boolean>) => void,
    ingress?: NativeDeliveryIngress,
  ): Promise<unknown>;
}
