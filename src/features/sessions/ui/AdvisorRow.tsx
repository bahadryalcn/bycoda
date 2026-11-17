import { AiIdea } from "../../../shared/ui/icons";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { ClampText } from "../../../shared/ui/ClampText";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { Text } from "../../../shared/ui/Text";
import { advisorModelName } from "../model/claudeAdvisor";
import type { Block } from "../model/session";
import { toolCallState } from "../model/transcriptActivity";

/**
 * The provider's own advisor (Claude Code's advisor tool) giving a second opinion inside the
 * main agent's turn. It is no separate session: one row names the advisor model and its state,
 * and the advice opens below it like a subagent's report.
 */
export function AdvisorRow({
  block,
  modelSettings,
}: {
  block: Block;
  modelSettings?: Record<string, string>;
}) {
  const t = useT();
  const state = toolCallState(block);
  const model = advisorModelName(modelSettings);
  const advice = block.tool?.detail?.trim();
  const status =
    state === "pending" ? (
      <Badge size="xs" appearance="subtle" tone="accent">
        {t("Thinking…")}
      </Badge>
    ) : (
      <Badge size="xs" appearance="subtle" tone={state === "accepted" ? "success" : "danger"}>
        {state === "accepted" ? t("Done") : t("Failed")}
      </Badge>
    );
  const summary = (
    <span className="flex min-w-0 items-center gap-2">
      <AiIdea className="icon-sm shrink-0" aria-hidden="true" />
      <Text size="inherit" tone="inherit" truncate className="min-w-0">
        {model ? `${t("Advisor")} · ${model}` : t("Advisor")}
      </Text>
      {status}
    </span>
  );
  return (
    <div data-advisor-row className="flex min-w-0 flex-col px-4 font-sans pbs-1 pbe-1.5">
      {advice ? (
        <Disclosure variant="plain" size="sm" textSize="caption" tone="secondary" summary={summary}>
          <ClampText
            as="div"
            lines={12}
            size="caption"
            tone="secondary"
            className="whitespace-pre-wrap [overflow-wrap:anywhere] ps-5"
          >
            {advice}
          </ClampText>
        </Disclosure>
      ) : (
        <Text as="div" size="caption" tone="secondary">
          {summary}
        </Text>
      )}
    </div>
  );
}
