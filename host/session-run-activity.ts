import type { HarnessEvent } from "../src/integrations/harness/core/types";

/** Provider work, not periodic usage/config/background-state refreshes. Repeated
 * nonempty tool output is still an observed output event even if its text matches. */
export function isSessionRunActivity(event: HarnessEvent, changed: boolean): boolean {
  switch (event.type) {
    case "message.delta":
    case "reasoning.delta":
      return event.text.length > 0;
    case "tool.updated":
      return (event.detail?.length ?? 0) > 0 || changed;
    case "agent.step":
      return (event.output?.length ?? 0) > 0 || changed;
    case "session.started":
    case "turn.started":
    case "tool.started":
    case "message.completed":
    case "reasoning.completed":
    case "image.generated":
    case "question.asked":
    case "question.resolved":
    case "approval.requested":
    case "approval.resolved":
    case "plan":
    case "interjection":
    case "tasks.updated":
      return changed;
    default:
      return false;
  }
}
