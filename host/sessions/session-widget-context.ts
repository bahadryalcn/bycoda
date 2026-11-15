import type {
  HostSession,
  HostSessionSummary,
} from "../../src/features/connections/model/protocol";
import { truncateGraphemes } from "../../src/shared/lib/text/truncate";

/** Authenticated summary only. Never send this object through push providers. */
export function sessionWidgetContext(
  value: HostSession,
  startedAt?: number,
  durationMs?: number,
): HostSessionSummary["widgetContext"] {
  const question = value.session.pendingQuestion;
  return {
    ...(value.status === "idle" &&
    Number.isFinite(startedAt) &&
    Number.isFinite(durationMs) &&
    durationMs! >= 0
      ? { completedAt: startedAt! + durationMs! }
      : {}),
    ...(question && !["sending", "queued"].includes(question.delivery ?? "")
      ? {
          questionPrompt: truncateGraphemes(
            question.questions[0]?.prompt ?? question.title ?? "",
            100,
          ),
        }
      : {}),
    ...(value.status === "running" && startedAt ? { startedAt } : {}),
    // Only structured signals classify failure. Never infer from issueMessage or block text.
    failureCategory: value.session.usageLimit
      ? "rate_limited"
      : value.status === "interrupted"
        ? "stopped"
        : "failed",
  };
}
