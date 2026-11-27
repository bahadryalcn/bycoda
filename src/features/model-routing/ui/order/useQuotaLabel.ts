import { useFormat, useT } from "../../../../shared/i18n";
import type { ModelRoutingEntryStatus } from "../../../../shared/model/host-contracts/model-routing";

/** "42% left", or the reason no percentage is known; shared by rows and account headers. */
export function useQuotaLabel() {
  const t = useT();
  const format = useFormat();
  return (status: ModelRoutingEntryStatus | undefined, loading: boolean, failed = false) =>
    status?.leftPercent == null
      ? loading || status?.limitState === "reading"
        ? t("Reading limit…")
        : failed || status?.limitState === "unavailable"
          ? t("Limit unavailable")
          : status?.limitState === "noQuota"
            ? t("No plan quota")
            : t("Limit unknown")
      : t("{p0}% left", { p0: format.formatNumber(status.leftPercent) });
}
