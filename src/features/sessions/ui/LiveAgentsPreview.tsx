import { Text } from "../../../shared/ui/Text";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { LiveText } from "../../../shared/ui/LiveText";
import { Badge } from "../../../shared/ui/Badge";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useId, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import {
  formatLiveElapsed,
  formatLiveMinutes,
  shouldShowLiveAgents,
  type LiveAgent,
} from "../model/liveAgents";
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
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Clock,
  Internet,
} from "../../../shared/ui/icons";
import { RailSectionHeader } from "../../../app/shell/useRailSections";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { SessionWorkingStatus } from "./SessionWorkingStatus";
import { sessionWaitReasonWith } from "../model/sessionWait";

const LIVE_AGENT_CAP = 4;

type Props = {
  agents: LiveAgent[];
  /** Project whose working conversations already appear in the workspace list. */
  currentProject?: string;
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
  currentProject,
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
  const [expandedProject, setExpandedProject] = useState<string | null>(null);
  const listId = useId();
  const lockList = useLockOverscroll<HTMLDivElement>();
  const summary = summarizeLiveAgents(agents);
  const currentProjectKey =
    currentProject && currentProject !== "~" ? projectKey(currentProject) : null;
  const projectAgents = currentProjectKey
    ? agents.filter(
        (agent) =>
          projectKey(agent.cwd) === currentProjectKey &&
          !agent.done &&
          !agent.issue &&
          !agent.needsApproval &&
          !agent.waiting,
      )
    : [];
  const projectWorkingCount = projectAgents.length;
  const projectExpanded = currentProjectKey != null && expandedProject === currentProjectKey;
  const attentionAgents = agents.filter((agent) => agent.issue || agent.needsApproval);
  const listedAgents = agents.filter(
    (agent) => !agent.issue && !agent.needsApproval && !projectAgents.includes(agent),
  );
  const visibleOnRail = projectWorkingCount > 0 || shouldShowLiveAgents(agents, activeSessionId);
  const ticking =
    visibleOnRail && !collapsed && agents.some((agent) => !agent.done && agent.startedAt != null);

  // Minute precision keeps the preview from re-rendering every second. The tick only
  // triggers the render; labels read the exact time.
  const now = useMinuteNow(ticking) ? wallClockNow() : 0;

  if (!visibleOnRail) return null;

  const cap = collapsible ? 2 : LIVE_AGENT_CAP;
  const extra = listedAgents.length - cap;
  const visible = expanded || extra <= 0 ? listedAgents : listedAgents.slice(0, cap);
  const title = t("Activity");
  const attentionTone =
    attentionAgents.length === 1 && attentionAgents[0].issue === "failed" ? "danger" : "warning";
  const statusMark = <Clock aria-hidden className="icon-sm shrink-0" strokeWidth={1.75} />;
  const countText = (
    <span className="inline-flex items-center gap-1">
      <Badge variant="count" size="xs" tone="neutral">
        {agents.length}
      </Badge>
      {collapsed && summary.attention > 0 ? (
        <Badge
          variant="count"
          size="xs"
          tone={attentionTone}
          aria-label={t(summary.attention === 1 ? "{p0} needs attention" : "{p0} need attention", {
            p0: summary.attention,
          })}
          icon={<CircleAlert aria-hidden className="icon-xs" />}
        >
          {summary.attention}
        </Badge>
      ) : null}
    </span>
  );
  const groups = [
    {
      key: "attention",
      label: t("Needs attention"),
      count: summary.attention,
      rows: attentionAgents,
    },
    {
      key: "working",
      label: t("Working"),
      count: summary.working,
      rows: [
        ...(projectExpanded ? projectAgents : []),
        ...visible.filter((agent) => !agent.done && !agent.waiting),
      ],
    },
    {
      key: "waiting",
      label: t("Waiting"),
      count: summary.waiting,
      rows: visible.filter((agent) => !agent.done && agent.waiting),
    },
    {
      key: "finished",
      label: t("Finished"),
      count: summary.finished,
      rows: visible.filter((agent) => agent.done),
    },
  ];
  // Announced when a count changes, never per second: elapsed times stay out of this text.
  const announcement = [
    summary.working > 0
      ? t(summary.working === 1 ? "{p0} working agent" : "{p0} working agents", {
          p0: summary.working,
        })
      : null,
    summary.waiting > 0
      ? t(summary.waiting === 1 ? "{p0} waiting agent" : "{p0} waiting agents", {
          p0: summary.waiting,
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
      aria-label={t("Activity")}
      className={`min-w-0 shrink-0 ${collapsible ? "mb-2" : "px-2"} ${bottomSpacing ? "pb-2" : ""}`}
      data-live-agents-preview="full"
      data-live-agents-headline={summary.headline}
      data-collapsed={collapsible && collapsed ? "" : undefined}
    >
      <LiveText className="sr-only" text={announcement} />
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
        <SectionLabel icon={statusMark} count={agents.length}>
          {title}
        </SectionLabel>
      )}
      <div id={listId} hidden={collapsed} className="px-2 pb-1">
        <div
          ref={lockList}
          className="flex max-h-[min(24rem,40vh)] flex-col gap-2 overflow-y-auto overscroll-none"
        >
          {groups.map((group) =>
            group.rows.length > 0 || (group.key === "working" && projectWorkingCount > 0) ? (
              <div key={group.key} data-live-agents-group={group.key} className="min-w-0">
                <SectionLabel
                  count={group.count}
                  tone={group.key === "attention" ? attentionTone : "secondary"}
                >
                  {group.label}
                </SectionLabel>
                {group.key === "working" && projectWorkingCount > 0 ? (
                  <Button
                    variant="item"
                    fullWidth
                    motion="none"
                    aria-expanded={projectExpanded}
                    aria-controls={`${listId}-project`}
                    onClick={() => setExpandedProject(projectExpanded ? null : currentProjectKey)}
                    aria-label={t("{p0} working in this project", { p0: projectWorkingCount })}
                    data-live-agents-project-summary
                    className="min-w-0 gap-1.5"
                  >
                    <Text
                      size="caption"
                      tone="secondary"
                      truncate
                      className="min-w-0 flex-1 text-start"
                    >
                      {t("This project")}
                    </Text>
                    <Badge variant="count" size="xs" tone="neutral">
                      {projectWorkingCount}
                    </Badge>
                    {projectExpanded ? (
                      <ChevronUp aria-hidden className="icon-sm shrink-0" />
                    ) : (
                      <ChevronDown aria-hidden className="icon-sm shrink-0" />
                    )}
                  </Button>
                ) : null}
                <div id={group.key === "working" ? `${listId}-project` : undefined}>
                  {group.rows.map((agent) => (
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
              </div>
            ) : null,
          )}
        </div>
        {extra > 0 ? (
          <Button
            fullWidth
            variant="item"
            motion="none"
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? (
              <ChevronUp aria-hidden className="icon-sm shrink-0" />
            ) : (
              <ChevronDown aria-hidden className="icon-sm shrink-0" />
            )}
            {expanded ? t("Show less") : t("{p0} more", { p0: extra })}
          </Button>
        ) : null}
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
  let waiting = 0;
  for (const agent of agents) {
    if (agent.issue || agent.needsApproval) attention += 1;
    else if (agent.done) finished += 1;
    else if (agent.waiting) waiting += 1;
    else working += 1;
  }
  const headline: "working" | "attention" | "waiting" | "finished" =
    working > 0 ? "working" : attention > 0 ? "attention" : waiting > 0 ? "waiting" : "finished";
  return { attention, finished, working, waiting, headline };
}

/** Title and count for the summary's headline group; shared by the full and compact rails. */
export function liveHeadline(
  summary: ReturnType<typeof summarizeLiveAgents>,
  t: (key: string) => string,
) {
  const { headline } = summary;
  return {
    title:
      headline === "working"
        ? t("Working")
        : headline === "attention"
          ? t("Needs attention")
          : headline === "waiting"
            ? t("Waiting")
            : t("Finished"),
    count: summary[headline],
  };
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
      ? formatLiveMinutes(agent.startedAt, now)
      : "";
  const activity = agent.issue
    ? t(agent.issue === "retrying" ? "Retrying" : "Failed")
    : agent.needsApproval
      ? t(agent.inputKind === "question" ? "Question" : "Need approval")
      : agent.done
        ? t("Done")
        : agent.waiting
          ? t("Waiting")
          : agent.activity;
  const live = !agent.issue && !agent.needsApproval && !agent.done && !agent.waiting;
  const remote = isRemoteProjectPath(agent.cwd);
  const waitReason = agent.waiting && !agent.done ? sessionWaitReasonWith(t, agent.waiting) : "";
  const title = [
    agent.title,
    remote ? `${project} (remote)` : project,
    waitReason || activity,
    elapsed,
  ]
    .filter(Boolean)
    .join("\n");

  const flagged = agent.issue || agent.needsApproval || agent.done || agent.waiting;
  const tone = agent.issue
    ? agent.issue === "failed"
      ? "danger"
      : "warning"
    : agent.needsApproval
      ? "warning"
      : agent.done
        ? "success"
        : agent.waiting
          ? "neutral"
          : "accent";
  return (
    <Button
      // shrink-0: the explicit min height lets flex squeeze a row below its two lines; the list scrolls instead.
      controlMinHeight="compact"
      padding={{ block: "xs" }}
      className="min-w-0 shrink-0 flex-col items-stretch gap-0.5 text-start"
      fullWidth
      motion="none"
      selected={selected}
      variant="item"
      type="button"
      tooltip={title}
      tooltipWhen={remote || !flagged ? "always" : "overflow"}
      aria-label={[agent.title, project, waitReason || activity, elapsed]
        .filter(Boolean)
        .join(", ")}
      aria-current={selected ? "true" : undefined}
      data-live-agent-card={agent.id}
      data-live-agent-state={
        agent.issue
          ? agent.issue
          : agent.needsApproval
            ? "input"
            : agent.done
              ? "done"
              : agent.waiting
                ? "waiting"
                : "working"
      }
      onClick={() => onSelect?.(agent.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5" data-live-agent-title>
        <HarnessIcon harness={agent.harness} className="icon-sm shrink-0" />
        <Text size="secondary" tone="inherit" leading="snug" truncate className="min-w-0 flex-1">
          {agent.title}
        </Text>
        <Text
          size="caption"
          tone={tone}
          className="inline-flex min-w-0 max-w-[50%] items-center gap-1"
          data-live-agent-status
        >
          {agent.issue || agent.needsApproval ? (
            <CircleAlert aria-hidden className="icon-xs shrink-0" />
          ) : agent.done ? (
            <Check aria-hidden className="icon-xs shrink-0" />
          ) : agent.waiting ? (
            <Clock aria-hidden className="icon-xs shrink-0" />
          ) : (
            <SessionWorkingStatus startedAt={agent.startedAt} showElapsed={false} />
          )}
          {flagged ? (
            <Text size="inherit" tone="inherit" truncate>
              {activity}
            </Text>
          ) : null}
        </Text>
      </span>
      {/* Secondary line: where the work lives on the left, its real state on the right. */}
      <Text
        size="caption"
        tone="secondary"
        leading="tight"
        className="flex min-w-0 items-center gap-1.5 ps-[calc(var(--ui-icon-sm)+0.375rem)]"
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
        <Text
          size="inherit"
          tone="inherit"
          truncate
          className="min-w-0 flex-1 @max-[220px]/rail:sr-only"
          data-live-agent-project
        >
          {project}
        </Text>
        {elapsed ? (
          <Text
            data-live-agent-elapsed
            size="inherit"
            tone="inherit"
            className="shrink-0 tabular-nums @max-[200px]/rail:hidden"
          >
            {elapsed}
          </Text>
        ) : null}
      </Text>
    </Button>
  );
}
