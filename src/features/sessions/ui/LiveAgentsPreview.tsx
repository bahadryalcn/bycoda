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
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Internet,
} from "../../../shared/ui/icons";
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
  const hasIssues = agents.some((agent) => agent.issue);
  const finishedCount = agents.filter((agent) => agent.done).length;
  const workingCount = agents.length - finishedCount;
  const hasWorkingAgents = workingCount > 0;
  const visibleOnRail = shouldShowLiveAgents(agents, activeSessionId);
  const ticking =
    visibleOnRail && !collapsed && agents.some((agent) => !agent.done && agent.startedAt != null);

  const now = useSharedNow(ticking);

  if (!visibleOnRail) return null;

  const cap = collapsible ? 2 : LIVE_AGENT_CAP;
  const extra = agents.length - cap;
  const visible = expanded || extra <= 0 ? agents : agents.slice(0, cap);
  const title = hasIssues ? t("Needs attention") : hasWorkingAgents ? t("Working") : t("Finished");
  const statusDot = (
    <span aria-hidden className="grid icon-sm shrink-0 place-items-center">
      <span
        className={`size-1.5 rounded-full ${
          hasWorkingAgents ? "bg-(--color-active)" : "bg-(--ui-text-muted)"
        }`}
      />
    </span>
  );

  return (
    <section
      aria-label={hasWorkingAgents ? t("Working agents") : t("Finished agents")}
      className={`min-w-0 shrink-0 ${collapsible ? "mb-3 data-[collapsed]:mb-0.5" : "px-2"} ${bottomSpacing ? "pb-2" : ""}`}
      data-live-agents-preview="full"
      data-collapsed={collapsible && collapsed ? "" : undefined}
    >
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {workingCount === 0
          ? t(finishedCount === 1 ? "{p0} finished agent" : "{p0} finished agents", {
              p0: finishedCount,
            })
          : finishedCount === 0
            ? t(workingCount === 1 ? "{p0} working agent" : "{p0} working agents", {
                p0: workingCount,
              })
            : t(
                workingCount === 1
                  ? finishedCount === 1
                    ? "{p0} working agent, {p2} finished agent"
                    : "{p0} working agent, {p2} finished agents"
                  : finishedCount === 1
                    ? "{p0} working agents, {p2} finished agent"
                    : "{p0} working agents, {p2} finished agents",
                { p0: workingCount, p2: finishedCount },
              )}
      </span>
      {/* On the rail the header is the shared 28px section row, not a framed card. */}
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
            icon={statusDot}
            count={agents.length}
            collapsed={collapsed}
            onToggleCollapsed={() => setCollapsed((value) => !value)}
            controlsId={listId}
          />
        ) : (
          <div className="flex w-full min-w-0 items-center gap-2 px-2.5 py-2 text-start">
            {statusDot}
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-(--ui-text-secondary)">
              {title}
            </span>
            <span className="rounded-md bg-(--ui-tone-accent-subtle) px-1.5 text-ui-micro font-medium tabular-nums text-(--ui-text-secondary)">
              {agents.length}
            </span>
          </div>
        )}
        <div id={listId} hidden={collapsed} className={collapsible ? "px-2" : undefined}>
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
  return (
    <Button
      // shrink-0: the explicit min height lets flex squeeze a row below its two lines; the list scrolls instead.
      className="min-h-(--ui-control-height-compact) min-w-0 shrink-0 flex-col items-stretch gap-0.5 py-1 text-start"
      fullWidth
      selected={selected}
      variant="item"
      type="button"
      title={title}
      aria-label={[agent.title, project, activity, elapsed].filter(Boolean).join(", ")}
      aria-current={selected ? "true" : undefined}
      data-live-agent-card={agent.id}
      onClick={() => onSelect?.(agent.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1.5" data-live-agent-title>
        <HarnessIcon harness={agent.harness} className="icon-sm shrink-0" />
        <span className="min-w-0 flex-1 truncate text-ui-secondary leading-snug">
          {agent.title}
        </span>
      </span>
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
        {/* The project name stays in the row's text and tooltip; the mascot identifies it visually. */}
        <span className="sr-only">{project}</span>
        <span
          title={activity}
          className={`flex min-w-0 items-center gap-1 ${flagged ? "flex-1" : ""} ${
            agent.issue === "failed"
              ? "text-(--ui-tone-danger-fg)"
              : agent.issue === "retrying"
                ? "text-(--ui-tone-warning-fg)"
                : agent.needsApproval
                  ? "text-(--ui-tone-warning-fg)"
                  : agent.done
                    ? "text-(--ui-tone-success-fg)"
                    : "text-(--ui-text-secondary)"
          }`}
        >
          {agent.issue || agent.needsApproval ? (
            <CircleAlert className="icon-xs shrink-0" strokeWidth={1.75} />
          ) : agent.done ? (
            <Check className="icon-xs shrink-0" strokeWidth={2.25} />
          ) : (
            <SessionWorkingStatus startedAt={agent.startedAt} />
          )}
          {flagged ? <span className="min-w-0 truncate">{activity}</span> : null}
        </span>
        {elapsed && flagged ? (
          <span className="ms-auto shrink-0 tabular-nums @max-[200px]/rail:hidden">
            {elapsed}
          </span>
        ) : null}
      </span>
    </Button>
  );
}
