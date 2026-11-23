import { useState } from "react";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import type { DockAgent } from "../model/activityDock";

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
  onOpen: (sessionId: string) => boolean | void;
}) {
  const t = useT();
  const [unavailable, setUnavailable] = useState<string>();
  const linked = agents.filter(
    (agent): agent is DockAgent & { sessionId: string } => !!agent.sessionId,
  );
  if (!linked.length && !unavailable) return null;
  const open = (sessionId: string) => {
    setUnavailable(onOpen(sessionId) === false ? sessionId : undefined);
  };
  const statusWord: Record<DockAgent["status"], string> = {
    running: t("Running"),
    done: t("Done"),
    failed: t("Failed"),
    stopped: t("Stopped by you"),
    interrupted: t("Interrupted"),
  };
  return (
    <section className="shrink-0 px-4 pt-2" data-nested-subagents>
      {linked.length ? <SectionLabel count={linked.length}>{t("Subagents")}</SectionLabel> : null}
      <ul className="flex flex-col">
        {linked.map((agent) => (
          <li key={agent.blockId} className="min-w-0">
            <Button
              variant="item"
              type="button"
              data-nested-subagent={agent.sessionId}
              aria-label={t("Open {p0}", {
                p0: [
                  agent.name,
                  agent.model,
                  agent.needsInput ? t("Needs input") : statusWord[agent.status],
                ]
                  .filter(Boolean)
                  .join(", "),
              })}
              onClick={() => open(agent.sessionId)}
              className="w-full min-w-0 items-center gap-2 text-start"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <Text size="inherit" weight="medium" truncate>
                  {agent.name}
                </Text>
                {agent.model ? (
                  <Text size="caption" tone="secondary" truncate>
                    {agent.model}
                  </Text>
                ) : null}
              </span>
              {agent.needsInput ? (
                <Badge size="xs" tone="warning" appearance="subtle">
                  {t("Needs input")}
                </Badge>
              ) : (
                <Text size="caption" tone="secondary">
                  {statusWord[agent.status]}
                </Text>
              )}
            </Button>
          </li>
        ))}
      </ul>
      {unavailable ? (
        <InlineError retry={{ onRetry: () => open(unavailable) }}>
          {t("This conversation is no longer available.")}
        </InlineError>
      ) : null}
    </section>
  );
}
