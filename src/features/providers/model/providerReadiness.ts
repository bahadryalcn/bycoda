import type { RateLimitStatus } from "./rateLimits";

/** CLI discovery and retained quota windows alone cannot verify current provider readiness. */
export function providerReadiness(input: {
  available: boolean;
  availabilityChecked: boolean;
  checking: boolean;
  status?: RateLimitStatus;
  auth?: "ready" | "low" | "exhausted" | "signedOut";
}): "checking" | "ready" | "unavailable" | "unknown" {
  if (input.checking || input.status === "fetching") return "checking";
  if (input.availabilityChecked && !input.available) return "unavailable";
  if (input.status !== "ok") return "unknown";
  if (input.auth === "signedOut" || input.auth === "exhausted") return "unavailable";
  return input.available && input.auth ? "ready" : "unknown";
}
