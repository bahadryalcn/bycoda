import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ChevronRight } from "../../../shared/ui/icons";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import type { DockAgent } from "../model/activityDock";
import { AgentStatusDot } from "./ActivityDock";

/**
 * The subagents a delegated child started itself, at the top of its sheet. A
 * row opens that run in the same sheet; one waiting on the user says so, and its
 * request is answered below in this sheet.
 */
export function NestedSubagentList({
  agents,
  onOpen,
}: {
  agents: readonly DockAgent[];
  onOpen: (sessionId: string) => void;
}) {
  const t = useT();
  if (!agents.length) return null;
  const statusWord: Record<DockAgent["status"], string> = {
    running: t("Running"),
    done: t("Done"),
    failed: t("Failed"),
    stopped: t("Stopped by you"),
    interrupted: t("Interrupted"),
  };
  return (
    <section className="shrink-0 px-4 pt-2" data-nested-subagents>
      <SectionLabel count={agents.length}>{t("Subagents")}</SectionLabel>
      <ul className="flex flex-col">
        {agents.map((agent) => (
          <li key={agent.blockId} className="min-w-0">
            <Button
              variant="item"
              type="button"
              data-nested-subagent={agent.sessionId}
              aria-label={t("Open {p0}", {
                p0: [agent.name, agent.model, statusWord[agent.status]].filter(Boolean).join(", "),
              })}
              onClick={() => agent.sessionId && onOpen(agent.sessionId)}
              className="w-full min-w-0 items-center gap-2 text-left"
            >
              <span className="flex shrink-0" aria-hidden="true">
                <AgentStatusDot status={agent.status} />
              </span>
              <Text size="inherit" weight="medium" truncate className="min-w-0">
                {agent.name}
              </Text>
              {agent.model ? (
                <Text size="micro" tone="muted" truncate className="min-w-0 shrink-[2]">
                  {agent.model}
                </Text>
              ) : null}
              <span className="flex-1" />
              {agent.needsInput ? (
                <Badge size="xs" tone="warning" appearance="subtle">
                  {t("Needs input")}
                </Badge>
              ) : null}
              <ChevronRight className="icon-xs shrink-0" tone="secondary" strokeWidth={1.75} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
