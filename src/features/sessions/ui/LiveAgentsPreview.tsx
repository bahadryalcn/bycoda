import { Text } from "../../../shared/ui/Text";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { LiveText } from "../../../shared/ui/LiveText";
import { Badge } from "../../../shared/ui/Badge";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useT } from "../../../shared/i18n";
import { useId, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatLiveMinutes, isLiveActivityAgent, type LiveAgent } from "../model/liveAgents";
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
import { CircleAlert, Clock, Internet } from "../../../shared/ui/icons";
import { RailSectionHeader } from "../../../app/shell/useRailSections";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { SessionWorkingStatus } from "./SessionWorkingStatus";
import { sessionWaitReasonWith } from "../model/sessionWait";

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
  const collapsed = collapsible && !expanded;
  const listId = useId();
  const lockList = useLockOverscroll<HTMLDivElement>();
  const grouped = groupLiveActivity(agents);
  const { attention, working, waiting } = grouped;
  const ticking =
    !collapsed && agents.some((agent) => isLiveActivityAgent(agent) && agent.startedAt != null);

  // Minute precision keeps the preview from re-rendering every second. The tick only
  // triggers the render; labels read the exact time.
  const now = useMinuteNow(ticking) ? wallClockNow() : 0;

  if (!attention.length && !working.length && !waiting.length) return null;

  const title = t("Activity");
  const summary = liveActivityCounts(grouped);
  const groups = [
    { label: t("Needs attention"), rows: attention },
    { label: t("Working"), rows: working },
    { label: t("Waiting"), rows: waiting },
  ];
  const statusMark = <Clock aria-hidden className="icon-sm shrink-0" strokeWidth={1.75} />;
  const countText = (
    <span className="inline-flex min-w-0 items-center gap-2">
      {attention.length > 0 ? (
        <Badge
          variant="count"
          size="xs"
          tone="warning"
          aria-label={t(attention.length === 1 ? "{p0} needs attention" : "{p0} need attention", {
            p0: attention.length,
          })}
          icon={<CircleAlert aria-hidden className="icon-xs" />}
        >
          {attention.length}
        </Badge>
      ) : null}
      {working.length > 0 ? (
        <Badge
          variant="count"
          size="xs"
          tone="neutral"
          aria-label={t(working.length === 1 ? "{p0} working agent" : "{p0} working agents", {
            p0: working.length,
          })}
          icon={<SessionWorkingStatus showElapsed={false} />}
        >
          {working.length}
        </Badge>
      ) : null}
      {waiting.length > 0 ? (
        <Badge
          variant="count"
          size="xs"
          tone="neutral"
          aria-label={t(waiting.length === 1 ? "{p0} waiting agent" : "{p0} waiting agents", {
            p0: waiting.length,
          })}
          icon={<Clock aria-hidden className="icon-xs" />}
        >
          {waiting.length}
        </Badge>
      ) : null}
    </span>
  );
  const renderCard = (agent: LiveAgent) => (
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
  );
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
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <section
      aria-label={t("Activity")}
      className={`min-w-0 shrink-0 ${bottomSpacing ? "pb-2" : ""}`}
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
          onToggleCollapsed={() => setExpanded((value) => !value)}
          controlsId={listId}
        />
      ) : (
        <SectionLabel icon={statusMark} count={attention.length + working.length + waiting.length}>
          {title}
        </SectionLabel>
      )}
      <div id={listId} hidden={collapsed} className="px-2 pb-1">
        <div
          ref={lockList}
          className="flex max-h-[min(14rem,30vh)] min-w-0 flex-col overflow-y-auto overscroll-none"
          data-live-agents-list
        >
          {groups.map(({ label, rows }) =>
            rows.length > 0 ? (
              <div key={label} className="min-w-0 shrink-0" data-live-agents-group>
                {/* One group needs no label: the section title already names it. */}
                {groups.filter((group) => group.rows.length > 0).length > 1 ? (
                  <SectionLabel variant="inline" className="block px-1.5 pt-1">
                    {label}
                  </SectionLabel>
                ) : null}
                {rows.map(renderCard)}
              </div>
            ) : null,
          )}
        </div>
      </div>
    </section>
  );
}

function groupLiveActivity(agents: readonly LiveAgent[]) {
  const groups: Record<"attention" | "working" | "waiting", LiveAgent[]> = {
    attention: [],
    working: [],
    waiting: [],
  };
  for (const agent of agents) {
    if (!isLiveActivityAgent(agent)) continue;
    if (agent.needsApproval || agent.issue === "retrying") {
      groups.attention.push(agent);
    } else if (agent.waiting) groups.waiting.push(agent);
    else groups.working.push(agent);
  }
  return groups;
}

function liveActivityCounts(groups: ReturnType<typeof groupLiveActivity>) {
  const { length: attention } = groups.attention;
  const { length: working } = groups.working;
  const { length: waiting } = groups.waiting;
  const headline: "working" | "attention" | "waiting" =
    working > 0 ? "working" : attention > 0 ? "attention" : "waiting";
  return { attention, working, waiting, headline };
}

export function summarizeLiveAgents(agents: readonly LiveAgent[]) {
  return liveActivityCounts(groupLiveActivity(agents));
}

/** Title and count for the compact rail's headline group. */
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
          : t("Waiting"),
    count: summary[headline],
  };
}

export function liveAgentHint({
  waitReason,
  remote,
  remoteLabel,
}: {
  waitReason: string;
  remote: boolean;
  remoteLabel: string;
}) {
  return [waitReason, remote ? remoteLabel : ""].filter(Boolean).join("\n");
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
  const elapsed = agent.startedAt != null ? formatLiveMinutes(agent.startedAt, now) : "";
  const needsAttention = agent.needsApproval || agent.issue === "retrying";
  const activity = agent.needsApproval
    ? t(agent.inputKind === "question" ? "Question" : "Need approval")
    : agent.issue === "retrying"
      ? t("Retrying")
      : agent.waiting
        ? t("Waiting")
        : agent.activity;
  const live = !needsAttention && !agent.waiting;
  const remote = isRemoteProjectPath(agent.cwd);
  const waitReason =
    !needsAttention && agent.waiting ? sessionWaitReasonWith(t, agent.waiting) : "";
  const hint = liveAgentHint({ waitReason, remote, remoteLabel: t("On another machine") });

  const tone = needsAttention ? "warning" : agent.waiting ? "neutral" : "accent";
  return (
    <Button
      // shrink-0: the explicit min height lets flex squeeze a row below its two lines; the list scrolls instead.
      controlMinHeight="compact"
      padding={{ block: "xxs" }}
      className="min-w-0 shrink-0 flex-col items-stretch gap-0.5 text-start"
      fullWidth
      motion="none"
      selected={selected}
      variant="item"
      type="button"
      tooltip={hint || undefined}
      aria-label={[
        agent.title,
        project,
        waitReason || activity,
        remote ? t("On another machine") : "",
        elapsed,
      ]
        .filter(Boolean)
        .join(", ")}
      aria-current={selected ? "true" : undefined}
      data-live-agent-card={agent.id}
      data-live-agent-state={
        agent.needsApproval
          ? "input"
          : needsAttention
            ? "retrying"
            : agent.waiting
              ? "waiting"
              : "working"
      }
      onClick={() => onSelect?.(agent.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5" data-live-agent-title>
        <HarnessIcon harness={agent.harness} className="icon-sm shrink-0" />
        <OverflowTooltip label={agent.title}>
          <Text size="secondary" tone="inherit" leading="snug" truncate className="min-w-0 flex-1">
            {agent.title}
          </Text>
        </OverflowTooltip>
      </span>
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
        {remote ? <Internet aria-hidden className="icon-xs shrink-0" strokeWidth={1.75} /> : null}
        <Text
          size="inherit"
          tone="inherit"
          truncate
          className="min-w-0 @max-[220px]/rail:sr-only"
          data-live-agent-project
        >
          {project}
        </Text>
        <Text
          size="inherit"
          tone={tone}
          className="inline-flex min-w-0 flex-1 items-center gap-1"
          data-live-agent-status
        >
          {needsAttention ? (
            <CircleAlert aria-hidden className="icon-xs shrink-0" />
          ) : agent.waiting ? (
            <Clock aria-hidden className="icon-xs shrink-0" />
          ) : (
            <SessionWorkingStatus startedAt={agent.startedAt} showElapsed={false} />
          )}
          {!live ? (
            <Text size="inherit" tone="inherit" truncate>
              {activity}
            </Text>
          ) : null}
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
