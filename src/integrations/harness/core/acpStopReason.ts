import { asRecord, stringField } from "../../../shared/lib/records";
import type { HarnessEvent } from "./types";

/** Report an answered ACP stop after closing streamed bubbles. Never replay it. */
export function reportAcpStopReason(
  response: unknown,
  onEvent: (event: HarnessEvent) => void,
): boolean {
  const reason = stringField(asRecord(response) ?? {}, "stopReason");
  if (!reason || reason === "end_turn") return false;
  if (reason === "cancelled") return true;
  const recovery =
    reason === "max_tokens"
      ? "The response reached the token limit and may be incomplete. Ask the agent to continue."
      : reason === "max_turn_requests"
        ? "The turn reached its request limit. Review the partial result, then ask the agent to continue."
        : reason === "refusal"
          ? "The agent refused this request. Revise the request before trying again."
          : "Review the partial result before sending another request.";
  onEvent({ type: "session.error", message: `Generation stopped (${reason}). ${recovery}` });
  return true;
}
