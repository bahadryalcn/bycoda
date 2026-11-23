import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";
import { Text } from "../../../shared/ui/Text";
import { Bot } from "../../../shared/ui/icons";
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
      icon: <AgentStatusDot status={agent.status} />,
      content: (
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <Text size="inherit" weight="medium" truncate>
            {agent.name}
          </Text>
          {agent.model ? (
            <Text size="caption" tone="secondary" className="flex min-w-0">
              <ModelLabel
                model={agent.model}
                harness={agent.harness}
                name={agent.model}
                size="xs"
              />
            </Text>
          ) : null}
        </span>
      ),
      trailing: elapsed ? (
        <Text size="caption" tone="secondary" className="shrink-0 tabular-nums">
          {elapsed}
        </Text>
      ) : null,
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
        aria-haspopup="menu"
        aria-expanded={open}
        data-composer-subagents-trigger
        onClick={() => setOpen((value) => !value)}
      >
        {running > 0 ? (
          <WorkingIndicator size="xs" />
        ) : (
          <Bot aria-hidden className="icon-sm" />
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
          size="lg"
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
