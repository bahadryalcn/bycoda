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
import { MemberAvatar, memberTraits } from "../../crews/public/mentions";
import { groupDockAgents, type DockAgent } from "../model/activityDock";
import { AgentStatusDot } from "./ActivityDock";
import { formatElapsed } from "./useElapsedFrom";

const SUBAGENTS_FACE = memberTraits({ id: "subagents" });

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
    const elapsed =
      agent.startedAt !== undefined && agent.endedAt !== undefined
        ? formatElapsed(Math.max(0, agent.endedAt - agent.startedAt))
        : "";
    return {
      kind: "item",
      id: agent.blockId,
      label: [agent.name, agent.model, statusWord[agent.status]].filter(Boolean).join(", "),
      icon: <AgentStatusDot status={agent.status} />,
      content: (
        <span className="flex min-w-0 flex-col">
          <Text as="span" size="inherit" tone="neutral" truncate>
            {agent.name}
          </Text>
          <Text as="span" size="caption" tone="muted" truncate>
            {[agent.model, statusWord[agent.status], elapsed].filter(Boolean).join(" · ")}
          </Text>
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
          <MemberAvatar traits={SUBAGENTS_FACE} size={16} />
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
          width={280}
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
