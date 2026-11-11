import type { AssistantSessionManagement } from "../model/session";
import { useAssistantIdentity } from "../../assistant/model/assistantClient";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Bot } from "../../../shared/ui/icons";

/** Host provenance only. Rendering this badge grants no session authority. */
export function AssistantManagedBadge({
  management,
  compact = false,
  local = true,
}: {
  management?: AssistantSessionManagement;
  compact?: boolean;
  local?: boolean;
}) {
  const t = useT();
  return management?.assistant && management.detachedAt === undefined ? (
    local ? (
      <ManagedBadge compact={compact} manual={"supervisionId" in management} />
    ) : (
      <ManagementMark
        label={t("supervisionId" in management ? "Supervision recorded" : "Managed session")}
        compact={compact}
      />
    )
  ) : null;
}
function ManagedBadge({ compact, manual }: { compact: boolean; manual: boolean }) {
  const t = useT();
  const { name } = useAssistantIdentity();
  const label = manual
    ? t("Supervision recorded")
    : name
      ? t("Managed by {p0}", { p0: name })
      : t("Managed session");
  return <ManagementMark label={label} compact={compact} />;
}
function ManagementMark({ label, compact }: { label: string; compact: boolean }) {
  return (
    <OverflowTooltip label={label}>
      <Badge tone="info" size="xs" aria-label={label} data-assistant-managed>
        {compact ? <Bot className="icon-xs" aria-hidden="true" /> : label}
      </Badge>
    </OverflowTooltip>
  );
}
