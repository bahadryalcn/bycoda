import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { groupDockAgents, type DockAgent } from "../model/activityDock";
import { AgentStatusDot } from "./ActivityDock";
import { ModelLabel } from "./ModelLabel";
import { formatElapsed } from "./useElapsedFrom";

/**
 * The session's subagents, past and running, behind one composer control. It
 * stays after the turn ends, so an old run can still be opened in its sheet.
 * Renders nothing when the session has none. Hidden while the activity dock lists
 * the same runs (`data-dock-subagents`), so one control shows them at a time.
 */
export function SessionSubagentsMenu({
  agents,
  onOpen,
}: {
  /** Newest first; see `sessionSubagents`. */
  agents: readonly DockAgent[];
  onOpen: (agent: DockAgent) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  if (agents.length === 0) return null;
  const running = agents.filter((agent) => agent.status === "running").length;
  const statusWord: Record<DockAgent["status"], string> = {
    running: t("Running"),
    done: t("Done"),
    failed: t("Failed"),
    stopped: t("Stopped by you"),
    interrupted: t("Interrupted"),
  };
  const row = (agent: DockAgent): DropdownMenuAction => {
    const status = statusWord[agent.status];
    const elapsed =
      agent.startedAt !== undefined && agent.endedAt !== undefined
        ? formatElapsed(Math.max(0, agent.endedAt - agent.startedAt))
        : "";
    return {
      kind: "item",
      id: agent.blockId,
      label: [agent.name, agent.model, status, elapsed].filter(Boolean).join(", "),
      title: `${agent.name} · ${status}`,
      icon: <AgentStatusDot status={agent.status} />,
      content: (
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <Text size="inherit" tone="neutral" weight="medium" truncate>
            {agent.name}
          </Text>
          {agent.model || elapsed ? (
            <Text size="caption" tone="secondary" className="flex items-center gap-2">
              {agent.model ? (
                <ModelLabel
                  model={agent.model}
                  harness={agent.harness}
                  name={agent.model}
                  size="xs"
                />
              ) : null}
              {elapsed ? <span className="ms-auto shrink-0 tabular-nums">{elapsed}</span> : null}
            </Text>
          ) : null}
        </span>
      ),
    };
  };
  const { standalone, phases } = groupDockAgents(agents);
  const items: DropdownMenuItem[] = [
    ...standalone.map(row),
    ...phases.map(({ id, phase, agents }): DropdownMenuItem => ({
      kind: "group",
      id,
      label: phase ? `${t("Workflow")} · ${phase}` : t("Workflow"),
      items: agents.map(row),
    })),
  ];
  const label =
    running > 0
      ? t("Session subagents: {p0} running of {p1}", { p0: running, p1: agents.length })
      : t("Session subagents: {p0}", { p0: agents.length });
  return (
    <>
      <Button
        ref={triggerRef}
        size="sm"
        variant="ghost"
        selected={open}
        aria-label={label}
        tooltip={t("Session subagents")}
        aria-haspopup="menu"
        aria-expanded={open}
        data-composer-subagents-trigger
        onClick={() => setOpen((value) => !value)}
      >
        {running > 0 ? (
          <WorkingIndicator size="xs" />
        ) : (
          <svg aria-hidden="true" width={16} height={16} viewBox="0 0 24 24" fill="none">
            <path
              d="M9 9V8a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2a4 4 0 0 1-4 4h-1"
              stroke="currentColor"
              strokeWidth={1.7}
              strokeLinecap="round"
            />
            <rect
              x={2}
              y={11}
              width={13}
              height={9}
              rx={4}
              stroke="currentColor"
              strokeWidth={1.7}
            />
            <path
              d="M6.5 15.5h.01m4 0h.01M13.5 8.5h.01m4 0h.01"
              stroke="currentColor"
              strokeWidth={2.2}
              strokeLinecap="round"
            />
          </svg>
        )}
        <Text as="span" size="inherit" tone="inherit">
          {agents.length}
        </Text>
      </Button>
      {open ? (
        <DropdownMenu
          anchor={triggerRef}
          returnFocusRef={triggerRef}
          label={t("Session subagents")}
          side="top"
          align="end"
          width={340}
          items={items}
          onPick={(id) => {
            const agent = agents.find((candidate) => candidate.blockId === id);
            if (agent) onOpen(agent);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
