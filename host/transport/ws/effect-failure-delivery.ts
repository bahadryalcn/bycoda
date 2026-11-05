import type { HostDispatchError } from "../dispatch";
import { HostDomainOutcomeError } from "../../domains/context";

/** Only the original domain owner can prove physical effect admission. */
export function effectFailureDelivery(
  error: HostDispatchError,
  dispatched: boolean,
  hasEffect: boolean,
) {
  if (error.code === "service-unavailable" && error.details?.delivery === "accepted")
    return "accepted";
  if (error.code === "service-unavailable" && error.cause instanceof HostDomainOutcomeError)
    return error.cause.delivery;
  return dispatched && hasEffect ? "unknown" : "not-sent";
}
