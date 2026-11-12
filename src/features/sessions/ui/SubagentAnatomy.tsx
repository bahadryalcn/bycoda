import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Text } from "../../../shared/ui/Text";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { t as translate, useT } from "../../../shared/i18n";
import { createContext, useContext } from "react";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";
import type { CrewMemberChild } from "../../../shared/model/host-contracts/delegation";
import { MemberAvatar, memberTraits } from "../../crews/public/mentions";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { blockLifecycle, type DockAgentStatus } from "../model/activityDock";
import { useModelIdentity } from "../model/modelHooks";
import type { AgentStep, Block, HarnessId } from "../model/session";
import {
  subagentReport,
  subagentStatusLine,
  subagentStatusParts,
  toolCallState,
  type SubagentStatusPart,
} from "../model/transcriptActivity";
import { AgentClock } from "./AgentClock";
import { AgentMarkdown } from "./AgentMarkdown";

/**
 * One anatomy for a delegated run, wherever it is shown: identity row (owned by
 * the host: mascot/name or sheet title) -> state line -> work trail -> report.
 * The inline transcript panel and the detached sheet both render the state line
 * and the report through these two pieces, so a run reads the same in either.
 */

type Translate = ReturnType<typeof useT>;

/** Same lifecycle rule as the dock (`blockLifecycle`), worded for a run. */
function lifecycleLabel(lifecycle: DockAgentStatus, t: Translate): string {
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

/** The harness of the turn a run belongs to, for runs whose model names no provider. */
export const RunHarness = createContext<HarnessId | undefined>(undefined);

/**
 * A run's marks: the mascot, hashed off its name so the same agent keeps the
 * same face, and the provider that runs it.
 */
export function SubagentMarks({
  name,
  harness,
  model,
  active = false,
  failed = false,
  member,
}: {
  name: string;
  /** A Crew member's run shows the member's portrait instead of the hashed mascot. */
  member?: CrewMemberChild;
  harness?: HarnessId;
  /** Model id; names the provider when `harness` is not known. */
  model?: string;
  active?: boolean;
  failed?: boolean;
}) {
  const turnHarness = useContext(RunHarness);
  const modelHarness = useModelIdentity(model)?.harness;
  const provider = harness ?? modelHarness ?? turnHarness;
  return (
    <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
      {member ? (
        <MemberAvatar
          traits={memberTraits({
            id: member.sourceId ?? member.id,
            source: member.sourceId ? { id: member.sourceId } : undefined,
            avatar: member.avatar as Parameters<typeof memberTraits>[0]["avatar"],
          })}
          size={16}
          active={active}
        />
      ) : (
        <ProjectMascot
          project={name}
          active={active}
          tone={failed ? "danger" : "secondary"}
          className="size-3.5 shrink-0"
        />
      )}
      {provider ? <HarnessIcon harness={provider} size="sm" /> : null}
    </span>
  );
}

export function runLabel(block: Block, busy: boolean): string {
  return lifecycleLabel(blockLifecycle(block, busy), translate);
}

/** `runLabel` with the caller's bound translator, for components the React Compiler compiles. */
export function runLabelWith(block: Block, busy: boolean, t: Translate): string {
  return lifecycleLabel(blockLifecycle(block, busy), t);
}

export function SubagentStatusSummary({
  parts,
  separator = ", ",
}: {
  parts: SubagentStatusPart[];
  separator?: string;
}) {
  return parts.map((part, index) => (
    <span key={index}>
      {index ? separator : ""}
      <Badge size="xs" appearance="subtle" tone={part.tone ?? "neutral"}>
        {part.text}
      </Badge>
    </span>
  ));
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
  inline = false,
  className = "",
}: {
  block: Block;
  busy: boolean;
  steps: AgentStep[];
  model?: string;
  inline?: boolean;
  className?: string;
}) {
  const t = useT();
  const run = block.agentRun;
  const lifecycle = blockLifecycle(block, busy);
  const running = lifecycle === "running";
  const failed = toolCallState(block) === "rejected";
  const summary = lifecycle === "stopped" ? "" : subagentStatusLine(block, steps);
  const identity = [run?.agentType, model].filter(Boolean).join(" · ");
  const visibleSummary = summary && !failed ? summary : undefined;
  return (
    <Text
      as={inline ? "span" : "div"}
      data-subagent-state
      className={`flex min-w-0 items-center gap-x-2 whitespace-nowrap ${className}`}
    >
      <Badge
        size="xs"
        appearance="subtle"
        tone={
          failed
            ? "danger"
            : running
              ? "accent"
              : lifecycle === "interrupted" || lifecycle === "stopped"
                ? "warning"
                : "success"
        }
        icon={running ? <StatusDot label={t("Running")} aria-hidden /> : undefined}
      >
        {lifecycleLabel(lifecycle, t)}
      </Badge>
      <AgentClock startedAt={run?.startedAt} endedAt={run?.endedAt} live={running} />
      {identity || visibleSummary ? (
        <Text size="inherit" tone="inherit" truncate className="min-w-0 flex-1">
          {identity}
          {identity && visibleSummary ? " · " : ""}
          {visibleSummary ? (
            <SubagentStatusSummary parts={subagentStatusParts(block, steps)} />
          ) : null}
        </Text>
      ) : null}
    </Text>
  );
}

/** The run's final answer or its failure reason; renders nothing without one. */
export function SubagentReport({
  block,
  cwd,
  onOpenFile,
  heading = "h3",
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
      <SectionLabel as={heading}>{failed ? t("Failure") : t("Report")}</SectionLabel>
      {failed ? (
        <OutputBlock tone="danger" density="comfortable" className="min-w-0 break-words">
          {report}
        </OutputBlock>
      ) : (
        <AgentMarkdown text={report} cwd={cwd} onOpenFile={onOpenFile} />
      )}
    </section>
  );
}
