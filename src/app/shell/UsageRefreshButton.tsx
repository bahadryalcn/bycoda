import { useT } from "../../shared/i18n";
import { Button } from "../../shared/ui/Button";
import { RefreshCw } from "../../shared/ui/icons";

/** Refresh belongs to the displayed quota account, including unavailable readings. */
export function UsageRefreshButton({
  accountId,
  onRefresh,
  refreshing,
  disabled,
}: {
  accountId?: string;
  onRefresh?: (accountId?: string) => Promise<void>;
  refreshing: boolean;
  disabled: boolean;
}) {
  const t = useT();
  if (!onRefresh) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      iconOnly
      label={t("Refresh usage")}
      className="ms-auto shrink-0"
      loading={refreshing}
      disabled={disabled}
      onClick={() => void onRefresh(accountId).catch(console.error)}
    >
      <RefreshCw className="icon-sm" aria-hidden />
    </Button>
  );
}
