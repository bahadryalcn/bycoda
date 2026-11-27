import { useT } from "../../../shared/i18n";
import { fitsOneLine } from "../../../shared/ui/ErrorDetails";
import { InlineError } from "../../../shared/ui/InlineError";
import type { Block } from "../model/session";
import { subagentReport } from "../model/transcriptActivity";

/** Asks that never started, one entry per role and reason, in first-seen order. */
function groupFailures(blocks: readonly Block[]) {
  const groups = new Map<string, { advisor: boolean; reason: string; count: number }>();
  for (const block of blocks) {
    const advisor = block.agentRun?.name === "Advisor";
    const reason = subagentReport(block) ?? "";
    const key = `${advisor}\n${reason}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { advisor, reason, count: 1 });
  }
  return [...groups.values()];
}

/**
 * Delegated asks the Host refused before any child session existed. Nothing ran, so there is
 * no card, status or trail: one line per reason says what could not start and why, and the
 * raw text moves behind Details only when it does not fit that line.
 */
export function SubagentStartFailures({
  blocks,
  embedded = false,
}: {
  blocks: readonly Block[];
  embedded?: boolean;
}) {
  const t = useT();
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${embedded ? "" : "px-4"}`}>
      {groupFailures(blocks).map(({ advisor, reason, count }) => {
        const summary = advisor
          ? count > 1
            ? t("{p0} advisors could not start", { p0: count })
            : t("Advisor could not start")
          : count > 1
            ? t("{p0} subagents could not start", { p0: count })
            : t("Subagent could not start");
        const inline = !reason || fitsOneLine(reason);
        return (
          <InlineError
            key={`${advisor}\n${reason}`}
            live="off"
            data-subagent-start-failure
            details={inline ? undefined : reason}
          >
            {/* oxlint-disable-next-line bycoda/no-raw-error-text -- a short Host refusal is the whole explanation; a Details click to read one line is what this line replaces. */}
            {inline && reason ? `${summary}: ${reason}` : summary}
          </InlineError>
        );
      })}
    </div>
  );
}
