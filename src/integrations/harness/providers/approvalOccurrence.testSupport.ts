import type { HarnessEvent } from "../core/types";
import { isApprovalOccurrenceId } from "../../../shared/model/approvalOccurrence";

/** Test drivers capture the actual emitted source request, never manufacture an ID. */
export function requestedApproval(events: readonly HarnessEvent[], requestId: number) {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index];
    if (event.type !== "approval.requested" || event.requestId !== requestId) continue;
    if (!isApprovalOccurrenceId(event.occurrenceId))
      throw new Error("Source approval occurrence missing");
    return event as typeof event & { occurrenceId: string };
  }
  throw new Error("Original emitted approval request missing");
}
