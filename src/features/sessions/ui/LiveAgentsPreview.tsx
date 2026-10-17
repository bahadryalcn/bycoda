import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
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
import { isRemoteProjectPath } from "../../projects/model/recents";
import { HarnessIcon } from "./HarnessIcon";
import { ProjectMascot } from "../../projects/ui/ProjectMascot";
import { TerminalSpinner } from "./TerminalSpinner";

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
  useLocale();
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
  const [now, setNow] = useState(() => Date.now());
  const lockList = useLockOverscroll<HTMLDivElement>();
  const hasIssues = agents.some((agent) => agent.issue);
  const finishedCount = agents.filter((agent) => agent.done).length;
  const workingCount = agents.length - finishedCount;
  const hasWorkingAgents = workingCount > 0;
  const visibleOnRail = shouldShowLiveAgents(agents, activeSessionId);
  const ticking =
    visibleOnRail && !collapsed && agents.some((agent) => !agent.done && agent.startedAt != null);

  useEffect(() => {
    if (!ticking) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [ticking]);

  if (!visibleOnRail) return null;

  const extra = agents.length - LIVE_AGENT_CAP;
  const visible = expanded || extra <= 0 ? agents : agents.slice(0, LIVE_AGENT_CAP);
  const Header = collapsible ? "button" : "div";

  return (
    <section
      aria-label={hasWorkingAgents ? t("Working agents") : t("Finished agents")}
      className={`shrink-0 ${collapsible ? "" : "px-2"} ${bottomSpacing ? "pb-2" : ""}`}
      data-live-agents-preview="full"
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
      {/* On the rail the header is a plain row in the navigation rhythm, not a framed card. */}
      <div
        className={
          collapsible
            ? ""
            : "overflow-hidden rounded-lg border border-(--ui-tone-accent-border) bg-(--ui-tone-accent-subtle)"
        }
      >
        <Header
          type={collapsible ? "button" : undefined}
          aria-expanded={collapsible ? !collapsed : undefined}
          onClick={collapsible ? () => setCollapsed((value) => !value) : undefined}
          className={`flex w-full items-center text-left ${collapsible ? "h-7 gap-2 rounded-[5px] px-2 hover:bg-(--ui-surface-hover) focus-visible:outline-2 focus-visible:outline-(--ui-focus-ring-color) focus-visible:-outline-offset-2" : "gap-2 px-2.5 py-2"}`}
        >
          <span
            aria-hidden
            className={`size-1.5 shrink-0 rounded-full ${collapsible ? "mx-1" : ""} ${
              hasWorkingAgents
                ? "bg-(--ui-tone-accent-subtle) shadow-[0_0_8px_var(--color-accent)] motion-safe:animate-pulse"
                : "bg-(--ui-surface-raised)"
            }`}
          />
          <span
            className={`min-w-0 flex-1 truncate text-(--ui-text-secondary) ${collapsible ? "text-[12px] font-medium" : "text-xs font-semibold"}`}
          >
            {hasIssues ? t("Needs attention") : hasWorkingAgents ? t("Working") : t("Finished")}
          </span>
          <span
            className={`text-[11px] font-medium tabular-nums text-(--ui-text-secondary) ${collapsible ? "" : "rounded-md bg-(--ui-tone-accent-subtle) px-1.5"}`}
          >
            {agents.length}
          </span>
          {collapsible ? (
            <ChevronDown
              className={`size-3.5 shrink-0 text-(--ui-text-secondary) transition-transform motion-reduce:transition-none ${collapsed ? "-rotate-90" : ""}`}
              strokeWidth={1.75}
            />
          ) : null}
        </Header>
        <div hidden={collapsed}>
          <div
            ref={lockList}
            className={`flex flex-col gap-px px-1 ${
              extra > 0 ? "" : "pb-1"
            } ${collapsible ? "max-h-[min(16rem,25vh)] overflow-y-auto overscroll-none" : expanded ? "max-h-[45vh] overflow-y-auto overscroll-none" : ""}`}
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
                <ChevronUp className="size-3" strokeWidth={1.75} />
              ) : (
                <ChevronDown className="size-3" strokeWidth={1.75} />
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
  useLocale();
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
      ? "Need approval"
      : agent.done
        ? "Done"
        : agent.activity;
  const live = !agent.needsApproval && !agent.done;
  const remote = isRemoteProjectPath(agent.cwd);
  const title = [agent.title, remote ? `${project} (remote)` : project, activity, elapsed]
    .filter(Boolean)
    .join("\n");

  return (
    <Button
      className="w-full flex-col text-left"
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
      <span className="flex min-w-0 items-center gap-2">
        <ProjectMascot
          project={seed}
          color={color}
          name={resolveTabGroupMascot(key, groupMascots)}
          className="size-2 shrink-0"
          active={live}
        />
        {live ? (
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug">
            {agent.title}
          </p>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold leading-snug">
            {agent.title}
          </span>
        )}
      </span>
      <span
        className={`mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-[11px] leading-tight ${
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
          <CircleAlert className="size-3 shrink-0" strokeWidth={1.75} />
        ) : agent.done ? (
          <Check className="size-3 shrink-0" strokeWidth={2.25} />
        ) : (
          <TerminalSpinner className="inline-block w-3 select-none text-center text-[11px] leading-none" />
        )}
        <span className="min-w-0 truncate">{activity}</span>
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1.5 pl-4 text-[11px] leading-tight text-(--ui-text-secondary)">
        <HarnessIcon harness={agent.harness} className="size-3 shrink-0" />
        {remote ? (
          <Internet
            aria-label={t("On another machine")}
            className="size-3 shrink-0"
            strokeWidth={1.75}
          />
        ) : null}
        <span className="min-w-0 flex-1 truncate">{project}</span>
        {elapsed ? <span className="shrink-0 tabular-nums">{elapsed}</span> : null}
      </span>
    </Button>
  );
}
