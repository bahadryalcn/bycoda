import type { ComponentProps } from "react";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { HarnessIcon } from "../../../shared/ui/identity/HarnessIcon";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { WorkingIndicator } from "../../../shared/ui/WorkingIndicator";
import { useAdvisorModelName } from "../model/reactiveReads";
import type { Block } from "../model/session";
import { toolCallState } from "../model/transcriptActivity";
import { AgentMarkdown } from "./AgentMarkdown";

/**
 * The provider's own advisor (Claude Code's advisor tool) giving a second opinion inside the
 * main agent's turn. It is no separate session: one row names the advisor model and its state,
 * and the full advice opens below it when the owner expands the row.
 */
export function AdvisorRow({
  block,
  modelSettings,
  cwd,
  onOpenFile,
  sessionBusy = true,
}: {
  block: Block;
  modelSettings?: Record<string, string>;
  cwd?: string;
  onOpenFile?: ComponentProps<typeof AgentMarkdown>["onOpenFile"];
  /** False once the session is idle: a call still marked pending then never got its answer. */
  sessionBusy?: boolean;
}) {
  const t = useT();
  const state = toolCallState(block);
  const model = useAdvisorModelName(modelSettings);
  const advice = block.tool?.detail?.trim();
  const status =
    state === "pending" && !sessionBusy ? null : state === "pending" ? (
      <WorkingIndicator size="sm" text={{ size: "caption" }}>
        {t("Thinking…")}
      </WorkingIndicator>
    ) : state === "accepted" ? null : (
      <Badge size="xs" appearance="subtle" tone="danger">
        {t("Failed")}
      </Badge>
    );
  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      <HarnessIcon harness="claude" size="sm" className="shrink-0" />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {model ? `${t("Advisor")} · ${model}` : t("Advisor")}
      </Text>
      {status}
    </span>
  );
  return (
    <div data-advisor-row className="flex min-w-0 flex-col px-4 pbs-1 pbe-1.5">
      {advice ? (
        <Disclosure variant="plain" size="sm" textSize="caption" tone="secondary" summary={summary}>
          <Text
            {...surfaceAttributes(
              { frame: "pane", edge: "inline-start" },
              "ms-2 min-w-0 ps-4 text-(--transcript-ink-body)",
            )}
            as="div"
            size="secondary"
            tone="inherit"
          >
            <AgentMarkdown text={advice} revealOnMount={false} cwd={cwd} onOpenFile={onOpenFile} />
          </Text>
        </Disclosure>
      ) : (
        <Text as="div" size="caption" tone="inherit" className="text-(--transcript-ink-chrome)">
          {summary}
        </Text>
      )}
    </div>
  );
}
