import { useT } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { StatusDot } from "../../../shared/ui/StatusDot";
import type { StewardRunStatus } from "../model/hostStewards";
import { STEWARD_STATUS_LABELS } from "../model/stewardClient";

export function StewardRunBadge({ status }: { status: StewardRunStatus }) {
  const t = useT();
  return (
    <Badge
      icon={status === "running" ? <StatusDot tone="accent" label={t("Running")} /> : undefined}
      tone={
        status === "failed"
          ? "danger"
          : status === "succeeded"
            ? "success"
            : status === "running"
              ? "accent"
              : "neutral"
      }
    >
      {t(STEWARD_STATUS_LABELS[status])}
    </Badge>
  );
}
