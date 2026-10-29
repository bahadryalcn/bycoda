import { t, useT } from "../../../shared/i18n";
import { blockLifecycle, type DockAgentStatus } from "../model/activityDock";
import type { AgentStep, Block } from "../model/session";
import { subagentReport, subagentStatusLine, toolCallState } from "../model/transcriptActivity";
import { AgentClock } from "./AgentClock";
import { AgentMarkdown } from "./AgentMarkdown";

/**
 * One anatomy for a delegated run, wherever it is shown: identity row (owned by
 * the host: mascot/name or sheet title) -> state line -> work trail -> report.
 * The inline transcript panel and the detached sheet both render the state line
 * and the report through these two pieces, so a run reads the same in either.
 */

/** Same lifecycle rule as the dock (`blockLifecycle`), worded for a run. */
function lifecycleLabel(lifecycle: DockAgentStatus): string {
  switch (lifecycle) {
    case "stopped":
      return t("Stopped by you");
    case "failed":
      return t("Failed");
    case "running":
      return t("Running");
    case "interrupted":
      return t("Interrupted");
    case "done":
      return t("Done");
  }
}

export function runLabel(block: Block, busy: boolean): string {
  return lifecycleLabel(blockLifecycle(block, busy));
}

/**
 * State and time lead; agent type, model and the step summary are quiet and
 * truncate. `busy` is whether the owning session is working, as for the dock.
 */
export function SubagentStateLine({
  block,
  busy,
  steps,
  model,
  className = "",
}: {
  block: Block;
  busy: boolean;
  steps: AgentStep[];
  model?: string;
  className?: string;
}) {
  const t = useT();
  const run = block.agentRun;
  const lifecycle = blockLifecycle(block, busy);
  const running = lifecycle === "running";
  const failed = toolCallState(block) === "rejected";
  const summary = lifecycle === "stopped" ? "" : subagentStatusLine(block, steps);
  const quietMeta = [run?.agentType, model, summary && !failed ? summary : undefined]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-subagent-state
      className={`flex min-w-0 items-center gap-x-2 text-ui-caption text-(--ui-text-secondary) ${className}`}
    >
      <span
        className={`shrink-0 font-medium ${
          failed
            ? "text-(--ui-tone-danger-fg)"
            : running
              ? "text-(--ui-tone-accent-fg)"
              : lifecycle === "interrupted"
                ? "text-(--ui-tone-warning-fg)"
                : "text-(--ui-tone-neutral-fg)"
        }`}
      >
        {lifecycleLabel(lifecycle)}
      </span>
      <AgentClock startedAt={run?.startedAt} endedAt={run?.endedAt} live={running} />
      {quietMeta ? (
        <span
          className="min-w-0 flex-1 truncate"
          title={model ? `${quietMeta} (${t("Model: {p0}", { p0: model })})` : quietMeta}
        >
          {quietMeta}
        </span>
      ) : null}
    </div>
  );
}

/** The run's final answer or its failure reason; renders nothing without one. */
export function SubagentReport({
  block,
  cwd,
  onOpenFile,
  heading: Heading = "h3",
  className = "",
}: {
  block: Block;
  cwd?: string;
  onOpenFile?: (path: string) => void;
  heading?: "h3" | "h4";
  className?: string;
}) {
  const t = useT();
  const report = subagentReport(block);
  if (!report) return null;
  const failed = toolCallState(block) === "rejected";
  return (
    <section
      aria-label={failed ? t("Failure") : t("Report")}
      className={`flex min-w-0 flex-col gap-1 ${className}`}
    >
      <Heading className="text-ui-caption font-medium text-(--ui-text-secondary)">
        {failed ? t("Failure") : t("Report")}
      </Heading>
      {failed ? (
        <pre className="min-w-0 whitespace-pre-wrap break-words font-mono text-ui-caption leading-5 text-(--ui-tone-danger-fg)">
          {report}
        </pre>
      ) : (
        <AgentMarkdown text={report} cwd={cwd} onOpenFile={onOpenFile} />
      )}
    </section>
  );
}
