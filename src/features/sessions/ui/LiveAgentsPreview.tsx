import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useId, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatLiveElapsed, shouldShowLiveAgents, type LiveAgent } from "../model/liveAgents";
import { projectKey, projectName } from "../../../shared/lib/paths";
import {
  loadTabGroupColors,
  loadTabGroupCustomColors,
  loadTabGroupLabels,
  loadTabGroupMascots,
  resolveTabGroupColor,
  resolveTabGroupLabel,
  resolveTabGroupMascot,
} from "../../workspace/model/tabGroups";
import { Check, ChevronDown, ChevronUp, CircleAlert, Internet } from "../../../shared/ui/icons";
import { RailSectionHeader } from "../../../app/shell/useRailSections";
import { isRemoteProjectPath } from "../../projects/model/recents";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { useSharedNow } from "./AgentClock";
import { SessionWorkingStatus } from "./SessionWorkingStatus";

const LIVE_AGENT_CAP = 4;

type Props = {
  agents: LiveAgent[];
  activeSessionId?: string;
  onSelect?: (sessionId: string) => void;
  bottomSpacing?: boolean;
  collapsible?: boolean;
  groupLabels?: Record<string, string>;
  groupColors?: Record<string, number>;
  groupCustomColors?: Record<string, string>;
  groupMascots?: Record<string, string>;
};

export function LiveAgentsPreview({
  agents,
  activeSessionId,
  onSelect,
  bottomSpacing = false,
  collapsible = false,
  groupLabels: groupLabelsProp,
  groupColors: groupColorsProp,
  groupCustomColors: groupCustomColorsProp,
  groupMascots: groupMascotsProp,
}: Props) {
  const t = useT();
  const [loadedGroupLabels] = useState(loadTabGroupLabels);
  const [loadedGroupColors] = useState(loadTabGroupColors);
  const [loadedGroupCustomColors] = useState(loadTabGroupCustomColors);
  const [loadedGroupMascots] = useState(loadTabGroupMascots);
  const groupLabels = groupLabelsProp ?? loadedGroupLabels;
  const groupColors = groupColorsProp ?? loadedGroupColors;
  const groupCustomColors = groupCustomColorsProp ?? loadedGroupCustomColors;
  const groupMascots = groupMascotsProp ?? loadedGroupMascots;
  const [expanded, setExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const listId = useId();
  const lockList = useLockOverscroll<HTMLDivElement>();
  const summary = summarizeLiveAgents(agents);
  const visibleOnRail = shouldShowLiveAgents(agents, activeSessionId);
  const ticking =
    visibleOnRail && !collapsed && agents.some((agent) => !agent.done && agent.startedAt != null);

  const now = useSharedNow(ticking);

  if (!visibleOnRail) return null;

  const cap = collapsible ? 2 : LIVE_AGENT_CAP;
  const extra = agents.length - cap;
  const visible = expanded || extra <= 0 ? agents : agents.slice(0, cap);
  const title =
    summary.headline === "working"
      ? t("Working")
      : summary.headline === "attention"
        ? t("Needs attention")
        : t("Finished");
  // The headline names one real state and counts only the agents in it. What needs the user
  // follows as short text, so "Working 3 · 2 need attention" never reads as five agents working.
  // Finished rows are listed below; they only join the line when nothing else is running.
  const tail = [
    summary.headline !== "attention" && summary.attention > 0
      ? t(summary.attention === 1 ? "{p0} needs attention" : "{p0} need attention", {
          p0: summary.attention,
        })
      : null,
    summary.headline === "attention" && summary.finished > 0
      ? t("{p0} finished", { p0: summary.finished })
      : null,
  ].filter(Boolean);
  const headlineCount =
    summary.headline === "working"
      ? summary.working
      : summary.headline === "attention"
        ? summary.attention
        : summary.finished;
  const statusMark =
    summary.headline === "attention" ? (
      <CircleAlert
        aria-hidden
        className="icon-sm shrink-0 text-(--ui-tone-warning-fg)"
        strokeWidth={1.75}
      />
    ) : summary.headline === "finished" ? (
      <Check aria-hidden className="icon-sm shrink-0 text-(--ui-tone-success-fg)" strokeWidth={2} />
    ) : (
      <span aria-hidden className="grid icon-sm shrink-0 place-items-center">
        <span className="size-1.5 rounded-full bg-(--color-active)" />
      </span>
    );
  const attentionNote =
    tail.length > 0 ? (
      <>
        {/* A rail too narrow for the sentence keeps a marked number instead. */}
        <span className="font-normal text-(--ui-text-secondary) @max-[220px]/rail:hidden">
          {" "}
          · {tail.join(" · ")}
        </span>
        {summary.headline !== "attention" && summary.attention > 0 ? (
          <span
            title={tail[0] ?? undefined}
            className="hidden items-center gap-0.5 ps-1 font-normal text-(--ui-tone-warning-fg) @max-[220px]/rail:inline-flex"
          >
            <CircleAlert aria-hidden className="icon-xs shrink-0" strokeWidth={1.75} />
            {summary.attention}
          </span>
        ) : null}
      </>
    ) : null;
  const countText = (
    <span className="whitespace-nowrap">
      {headlineCount}
      {attentionNote}
    </span>
  );
  // Announced when a count changes, never per second: elapsed times stay out of this text.
  const announcement = [
    summary.working > 0
      ? t(summary.working === 1 ? "{p0} working agent" : "{p0} working agents", {
          p0: summary.working,
        })
      : null,
    summary.attention > 0
      ? t(summary.attention === 1 ? "{p0} needs attention" : "{p0} need attention", {
          p0: summary.attention,
        })
      : null,
    summary.finished > 0
      ? t(summary.finished === 1 ? "{p0} finished agent" : "{p0} finished agents", {
          p0: summary.finished,
        })
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      aria-label={
        summary.headline === "working"
          ? t("Working agents")
          : summary.headline === "attention"
            ? t("Agents needing attention")
            : t("Finished agents")
      }
      className={`min-w-0 shrink-0 ${
        collapsible
          ? "mb-2 rounded-lg border border-(--ui-pane-border) bg-(--ui-surface-quiet) data-[collapsed]:mb-0.5"
          : "px-2"
      } ${bottomSpacing ? "pb-2" : ""}`}
      data-live-agents-preview="full"
      data-live-agents-headline={summary.headline}
      data-collapsed={collapsible && collapsed ? "" : undefined}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      {/* On the rail the header is the shared 28px section row: one line with status mark,
          title, summary counts and the collapse control. */}
      <div
        className={
          collapsible
            ? ""
            : "overflow-hidden rounded-lg border border-(--ui-tone-accent-border) bg-(--ui-tone-accent-subtle)"
        }
      >
        {collapsible ? (
          <RailSectionHeader
            label={title}
            icon={statusMark}
            count={countText}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            controlsId={listId}
          />
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-start">
            {statusMark}
            <span className="min-w-0 flex-1 truncate text-ui-caption font-semibold text-(--ui-text-secondary)">
              {title}
            </span>
            <span className="rounded-md bg-(--ui-tone-accent-subtle) px-1.5 text-ui-micro font-medium tabular-nums text-(--ui-text-secondary)">
              {countText}
            </span>
          </div>
        )}
        <div id={listId} hidden={collapsed} className={collapsible ? "px-1 pb-1" : undefined}>
          <div
            ref={lockList}
            className={`flex flex-col gap-px ${collapsible ? "" : "px-1"} ${
              extra > 0 || collapsible ? "" : "pb-1"
            } ${collapsible ? "max-h-[min(18rem,30vh)] overflow-y-auto overscroll-none [scrollbar-gutter:stable]" : expanded ? "max-h-[45vh] overflow-y-auto overscroll-none" : ""}`}
          >
            {visible.map((agent) => (
              <LiveAgentCard
                key={agent.id}
                agent={agent}
                now={now}
                selected={agent.id === activeSessionId}
                onSelect={onSelect}
                groupLabels={groupLabels}
                groupColors={groupColors}
                groupCustomColors={groupCustomColors}
                groupMascots={groupMascots}
              />
            ))}
          </div>
          {extra > 0 ? (
            <Button
              fullWidth
              variant="item"
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((open) => !open)}
              className="w-full"
            >
              {expanded ? (
                <ChevronUp className="icon-sm shrink-0" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="icon-sm shrink-0" strokeWidth={1.75} />
              )}
              {expanded ? t("Show less") : t("{p0} more", { p0: extra })}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * Real counts behind the header. Failed or retrying agents and agents waiting for input need
 * attention; a finished agent is `done` without an issue; the rest are running. The headline is
 * the most urgent non-empty group, so a mixed list is never labelled by one row.
 */
export function summarizeLiveAgents(agents: readonly LiveAgent[]) {
  let attention = 0;
  let finished = 0;
  let working = 0;
  for (const agent of agents) {
    if (agent.issue || agent.needsApproval) attention += 1;
    else if (agent.done) finished += 1;
    else working += 1;
  }
  const headline: "working" | "attention" | "finished" =
    working > 0 ? "working" : attention > 0 ? "attention" : "finished";
  return { attention, finished, working, headline };
}

function LiveAgentCard({
  agent,
  now,
  selected,
  onSelect,
  groupLabels,
  groupColors,
  groupCustomColors,
  groupMascots,
}: {
  agent: LiveAgent;
  now: number;
  selected: boolean;
  onSelect?: (sessionId: string) => void;
  groupLabels: Record<string, string>;
  groupColors: Record<string, number>;
  groupCustomColors: Record<string, string>;
  groupMascots: Record<string, string>;
}) {
  const t = useT();
  const seed = projectName(agent.cwd);
  const key = projectKey(agent.cwd);
  const project = resolveTabGroupLabel(key, groupLabels, seed);
  const color = resolveTabGroupColor(key, groupColors, groupCustomColors, seed);
  const elapsed = agent.done
    ? agent.durationMs != null
      ? formatLiveElapsed(0, agent.durationMs)
      : ""
    : agent.startedAt != null
      ? formatLiveElapsed(agent.startedAt, now)
      : "";
  const activity = agent.issue
    ? t(agent.issue === "retrying" ? "Retrying" : "Failed")
    : agent.needsApproval
      ? t(agent.inputKind === "question" ? "Question" : "Need approval")
      : agent.done
        ? "Done"
        : agent.activity;
  const live = !agent.needsApproval && !agent.done;
  const remote = isRemoteProjectPath(agent.cwd);
  const title = [agent.title, remote ? `${project} (remote)` : project, activity, elapsed]
    .filter(Boolean)
    .join("\n");

  const flagged = agent.issue || agent.needsApproval || agent.done;
  const tone = agent.issue
    ? agent.issue === "failed"
      ? "text-(--ui-tone-danger-fg)"
      : "text-(--ui-tone-warning-fg)"
    : agent.needsApproval
      ? "text-(--ui-tone-warning-fg)"
      : agent.done
        ? "text-(--ui-tone-success-fg)"
        : "text-(--ui-text-secondary)";
  return (
    <Button
      // shrink-0: the explicit min height lets flex squeeze a row below its two lines; the list scrolls instead.
      className="min-h-(--ui-control-height-compact) min-w-0 shrink-0 flex-col items-stretch gap-0.5 py-1 text-start"
      fullWidth
      selected={selected}
      variant="item"
      type="button"
      tooltip={title}
      tooltipWhen={remote || !flagged ? "always" : "overflow"}
      aria-label={[agent.title, project, activity, elapsed].filter(Boolean).join(", ")}
      aria-current={selected ? "true" : undefined}
      data-live-agent-card={agent.id}
      data-live-agent-state={
        agent.issue ? agent.issue : agent.needsApproval ? "input" : agent.done ? "done" : "working"
      }
      onClick={() => onSelect?.(agent.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5" data-live-agent-title>
        <HarnessIcon harness={agent.harness} className="icon-sm shrink-0" />
        <span className="min-w-0 flex-1 truncate text-ui-secondary leading-snug">
          {agent.title}
        </span>
        {elapsed ? (
          <span
            data-live-agent-elapsed
            className="shrink-0 text-ui-caption tabular-nums text-(--ui-text-secondary) @max-[200px]/rail:hidden"
          >
            {elapsed}
          </span>
        ) : null}
      </span>
      {/* Secondary line: where the work lives on the left, its real state on the right. */}
      <span
        className="flex min-w-0 items-center gap-1.5 ps-[calc(var(--ui-icon-sm)+0.375rem)] text-ui-caption leading-tight text-(--ui-text-secondary)"
        data-live-agent-details
      >
        <ProjectMascot
          project={seed}
          color={color}
          name={resolveTabGroupMascot(key, groupMascots)}
          className="icon-xs shrink-0"
          active={live}
        />
        {remote ? (
          <Internet
            aria-label={t("On another machine")}
            className="icon-xs shrink-0"
            strokeWidth={1.75}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate @max-[220px]/rail:sr-only" data-live-agent-project>
          {project}
        </span>
        <span
          className={`flex min-w-0 max-w-[60%] shrink-0 items-center gap-1 @max-[220px]/rail:max-w-full @max-[220px]/rail:flex-1 ${tone}`}
          data-live-agent-status
        >
          {agent.issue || agent.needsApproval ? (
            <CircleAlert className="icon-xs shrink-0" strokeWidth={1.75} />
          ) : agent.done ? (
            <Check className="icon-xs shrink-0" strokeWidth={2} />
          ) : (
            <SessionWorkingStatus startedAt={agent.startedAt} showElapsed={false} />
          )}
          {flagged ? <span className="min-w-0 truncate">{activity}</span> : null}
        </span>
      </span>
    </Button>
  );
}
