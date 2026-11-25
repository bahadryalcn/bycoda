import { Text } from "../../../shared/ui/Text";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { LiveText } from "../../../shared/ui/LiveText";
import { Badge } from "../../../shared/ui/Badge";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { useFormat, useT } from "../../../shared/i18n";
import { useId, useState } from "react";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { formatLiveMinutes, type LiveAgent } from "../model/liveAgents";
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
  CircleAlert,
  CircleX,
  Clock,
  Internet,
  MessageSquare,
  RotateCcw,
} from "../../../shared/ui/icons";
import { RailSectionHeader } from "../../../app/shell/useRailSections";
import { isRemoteProjectPath } from "../../projects/public/recents";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectMascot } from "../../projects/public/ProjectMascot";
import { useMinuteNow } from "../../../shared/hooks/useMinuteNow";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
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
  const rows = orderLiveActivity(agents);
  const format = useFormat();
  const ticking = !collapsed && rows.some((agent) => !agent.done && agent.startedAt != null);
  const now = useMinuteNow(ticking) ? wallClockNow() : 0;

  if (rows.length === 0) return null;

  const title = t("Activity");
  const counts = liveActivityCounts(rows, t, format.formatNumber);
  const statusMark = <Clock aria-hidden className="icon-sm shrink-0" strokeWidth={1.75} />;
  const countText = (
    <span className="inline-flex min-w-0 flex-wrap items-center justify-end gap-x-1 gap-y-0.5">
      {counts.map(({ state, count, label }) => (
        <Badge
          key={state}
          variant="count"
          size="xs"
          tone={activityStates[state].tone}
          aria-label={label}
          icon={<ActivityMark state={state} />}
        >
          {count}
        </Badge>
      ))}
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
  const announcement = counts.map(({ label }) => label).join(", ");

  return (
    <section
      aria-label={t("Activity")}
      className={`min-w-0 shrink-0 ${bottomSpacing ? "pb-2" : ""}`}
      data-live-agents-preview="full"
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
        <SectionLabel icon={statusMark} actions={countText}>
          {title}
        </SectionLabel>
      )}
      <div id={listId} hidden={collapsed} className="px-2 pb-1">
        <div
          ref={lockList}
          className="flex max-h-[min(14rem,30vh)] min-w-0 flex-col overflow-y-auto overscroll-none"
          data-live-agents-list
        >
          {/* Collapsed: cards are not built; counts and the live announcement above come from `rows`. */}
          {collapsed ? null : rows.map(renderCard)}
        </div>
      </div>
    </section>
  );
}

const activityStates = {
  working: { label: "Working", tone: "accent", icon: WorkingIndicator },
  failed: { label: "Failed", tone: "danger", icon: CircleX },
  question: { label: "Question", tone: "warning", icon: MessageSquare },
  done: { label: "Done", tone: "success", icon: Check },
  approval: { label: "Need approval", tone: "warning", icon: CircleAlert },
  input: { label: "Needs input", tone: "warning", icon: CircleAlert },
  retrying: { label: "Retrying", tone: "warning", icon: RotateCcw },
  waiting: { label: "Waiting", tone: "neutral", icon: Clock },
} as const;

type ActivityState = keyof typeof activityStates;

function liveActivityState(agent: LiveAgent): ActivityState {
  if (agent.needsApproval) return agent.inputKind ?? "input";
  if (agent.issue) return agent.issue;
  if (agent.done) return "done";
  return agent.waiting ? "waiting" : "working";
}

export function liveActivityStatus(agent: LiveAgent, t: ReturnType<typeof useT>) {
  const state = liveActivityState(agent);
  const { tone, label } = activityStates[state];
  return { state, tone, label: t(label) };
}

function ActivityMark({ state }: { state: ActivityState }) {
  if (state === "working") return <WorkingIndicator />;
  const Icon = activityStates[state].icon;
  return <Icon aria-hidden className="icon-xs shrink-0" />;
}

export function orderLiveActivity(agents: readonly LiveAgent[]) {
  return [...agents].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
}

export function liveActivityCounts(
  agents: readonly LiveAgent[],
  t: ReturnType<typeof useT>,
  formatCount: (count: number) => string,
) {
  const counts = new Map<ActivityState, number>();
  for (const agent of agents) {
    const state = liveActivityState(agent);
    counts.set(state, (counts.get(state) ?? 0) + 1);
  }
  return (Object.keys(activityStates) as ActivityState[]).flatMap((state) => {
    const count = counts.get(state);
    if (!count) return [];
    const label =
      state === "working"
        ? t(count === 1 ? "{p0} working agent" : "{p0} working agents", { p0: count })
        : state === "waiting"
          ? t(count === 1 ? "{p0} waiting agent" : "{p0} waiting agents", { p0: count })
          : `${t(activityStates[state].label)}: ${formatCount(count)}`;
    return [{ state, count, label }];
  });
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
  const { state, tone, label } = liveActivityStatus(agent, t);
  const elapsed =
    !agent.done && agent.startedAt != null ? formatLiveMinutes(agent.startedAt, now) : "";
  const remote = isRemoteProjectPath(agent.cwd);
  const waitReason =
    state === "waiting" && agent.waiting ? sessionWaitReasonWith(t, agent.waiting) : "";
  const hint = liveAgentHint({ waitReason, remote, remoteLabel: t("On another machine") });

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
      aria-label={[agent.title, project, label, waitReason, elapsed].filter(Boolean).join(", ")}
      aria-current={selected ? "true" : undefined}
      data-live-agent-card={agent.id}
      data-live-agent-state={state}
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
          active={state === "working"}
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
          className="min-w-0 @max-[220px]/rail:sr-only"
          data-live-agent-project
        >
          {project}
        </Text>
        <Badge
          appearance="subtle"
          size="xs"
          tone={tone}
          className="ms-auto shrink-0"
          data-live-agent-status
          icon={<ActivityMark state={state} />}
        >
          {label}
          {elapsed ? (
            <span
              data-live-agent-elapsed
              className="ms-1 shrink-0 tabular-nums @max-[200px]/rail:hidden"
            >
              {elapsed}
            </span>
          ) : null}
        </Badge>
      </Text>
    </Button>
  );
}
