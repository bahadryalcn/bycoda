import type { AssistantSessionManagement } from "../model/session";
import { useAssistantIdentity } from "../../assistant/model/assistantClient";
import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { OverflowTooltip, Tooltip } from "../../../shared/ui/Tooltip";
import styles from "./AssistantManagedBadge.module.css";

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
        label={"supervisionId" in management ? t("Supervision recorded") : t("Managed session")}
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
  const badge = (
    <Badge
      tone="info"
      size="xs"
      appearance={compact ? "subtle" : "outline"}
      role={compact ? "img" : undefined}
      aria-label={label}
      data-assistant-managed
    >
      {compact ? <span className={`icon-xs ${styles.mark}`} aria-hidden="true" /> : label}
    </Badge>
  );
  return compact ? (
    <Tooltip label={label} asChild>
      {badge}
    </Tooltip>
  ) : (
    <OverflowTooltip label={label}>{badge}</OverflowTooltip>
  );
}
