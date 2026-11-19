import {
  MODEL_ROUTING_CONFLICT_CODE,
  MODEL_ROUTING_CONFLICT_MESSAGE,
} from "../../../shared/model/host-contracts/model-routing";
import { classifyRemoteError } from "../../connections/public/remoteFailure";

const CODE_PREFIX = new RegExp(`^${MODEL_ROUTING_CONFLICT_CODE}:\\s*`);

/**
 * The Host refused a routing save because `expectedVersion` is stale. Only the Host's machine
 * code or, for Hosts without it, its exact legacy message counts; any other text that merely
 * mentions "version" or "changed" is an ordinary failure and must not force a Reload.
 */
export function isRoutingSaveConflict(cause: unknown): boolean {
  if (typeof cause === "object" && cause !== null && "code" in cause)
    if (cause.code === MODEL_ROUTING_CONFLICT_CODE) return true;
  const message = classifyRemoteError(cause).message;
  return CODE_PREFIX.test(message) || message === MODEL_ROUTING_CONFLICT_MESSAGE;
}

/** The Host message without its machine code, for the person reading it. */
export function routingSaveMessage(message: string): string {
  return message.replace(CODE_PREFIX, "");
}
