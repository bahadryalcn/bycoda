import type { HarnessEvent } from "./types";
import { asRecord, numberField, sumNumbers } from "../../../shared/lib/records";

export function acpUsageEvents(
  update: Record<string, unknown>,
  policy: { usedFields: readonly string[]; topLevelFields: readonly string[] },
): HarnessEvent[] {
  const usage =
    asRecord(update.usage) ??
    asRecord(update.tokenUsage) ??
    asRecord(update.token_usage) ??
    (policy.topLevelFields.some((field) => numberField(update, field) != null) ? update : null);
  if (!usage) return [];
  const used =
    policy.usedFields.map((field) => numberField(usage, field)).find((value) => value != null) ??
    sumNumbers(usage, ["inputTokens", "outputTokens", "input_tokens", "output_tokens"]);
  const window =
    numberField(usage, "window") ??
    numberField(usage, "size") ??
    numberField(usage, "contextWindow") ??
    numberField(usage, "context_window") ??
    numberField(usage, "maxTokens") ??
    numberField(usage, "max_tokens");
  const events: HarnessEvent[] = [];
  if (used != null || window != null) {
    events.push({
      type: "context",
      ...(used != null ? { used } : {}),
      ...(window != null ? { window } : {}),
    });
  }
  const inputTokens = numberField(usage, "inputTokens") ?? numberField(usage, "input_tokens");
  const outputTokens = numberField(usage, "outputTokens") ?? numberField(usage, "output_tokens");
  const cacheReadTokens =
    numberField(usage, "cacheReadTokens") ?? numberField(usage, "cache_read_input_tokens");
  const cacheWriteTokens =
    numberField(usage, "cacheWriteTokens") ?? numberField(usage, "cache_creation_input_tokens");
  const cacheReported = cacheReadTokens != null || cacheWriteTokens != null;
  if (
    inputTokens != null ||
    outputTokens != null ||
    cacheReadTokens != null ||
    cacheWriteTokens != null
  ) {
    const cacheableInput = (inputTokens ?? 0) + (cacheReadTokens ?? 0) + (cacheWriteTokens ?? 0);
    events.push({
      type: "turn.metrics",
      ...(inputTokens != null ? { inputTokens } : {}),
      ...(outputTokens != null ? { outputTokens } : {}),
      ...(cacheReadTokens != null ? { cacheReadTokens } : {}),
      ...(cacheWriteTokens != null ? { cacheWriteTokens } : {}),
      ...(cacheReported && cacheableInput > 0
        ? { cacheHitPercent: ((cacheReadTokens ?? 0) / cacheableInput) * 100 }
        : {}),
    });
  }
  return events;
}
