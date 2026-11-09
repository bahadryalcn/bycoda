import { useSyncExternalStore } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RefreshCw } from "../../../shared/ui/icons";
import { hasLiveCatalog } from "../../sessions/model/models";
import { HARNESS_TITLE, type HarnessId } from "../../sessions/model/session";
import { SettingsFeedback } from "../../settings/ui/settingsControls";
import {
  getCatalogReceipt,
  getCatalogReceiptsSnapshot,
  refreshProviderCatalog,
  subscribeCatalogReceipts,
} from "../model/catalogReceipts";

/**
 * Says where the model list comes from and whether the last refresh worked.
 * A list that survived a refresh is retained data, never proof that the
 * models are available to the signed-in account.
 */
export function CatalogReceiptStatus({
  harness,
  available,
}: {
  harness: HarnessId;
  available: boolean;
}) {
  useLocale();
  useSyncExternalStore(
    subscribeCatalogReceipts,
    getCatalogReceiptsSnapshot,
    getCatalogReceiptsSnapshot,
  );
  const receipt = getCatalogReceipt(harness);
  if (!available) return null;
  const refreshing = receipt?.status === "refreshing";
  const retry = (label: string) => (
    <Button
      size="sm"
      variant="ghost"
      disabled={refreshing}
      loading={refreshing}
      startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />}
      aria-label={t("{p0} for {p1} models", { p0: label, p1: HARNESS_TITLE[harness] })}
      onClick={() => void refreshProviderCatalog(harness, { force: true })}
    >
      {label}
    </Button>
  );

  if (receipt?.status === "refreshing") {
    return <SettingsFeedback state="loading">{t("Refreshing the model list…")}</SettingsFeedback>;
  }
  if (receipt?.status === "error") {
    return (
      <SettingsFeedback state="error" action={retry(t("Retry"))}>
        {receipt.retained
          ? t("Could not refresh models: {p0} Showing the earlier list ({p1}).", {
              p0: receipt.error,
              p1: receipt.count,
            })
          : t("Could not refresh models: {p0} Showing the built-in list ({p1}).", {
              p0: receipt.error,
              p1: receipt.count,
            })}
      </SettingsFeedback>
    );
  }
  if (receipt?.status === "retained") {
    return (
      <SettingsFeedback state="warning" action={retry(t("Refresh"))}>
        {t("The CLI returned no new model list. Showing the earlier list ({p0}).", {
          p0: receipt.count,
        })}
      </SettingsFeedback>
    );
  }
  if (receipt?.status === "bundled" || (!receipt && !hasLiveCatalog(harness))) {
    return (
      <SettingsFeedback state="warning" action={retry(t("Refresh"))}>
        {t("Showing the built-in model list. It was not discovered from the CLI.")}
      </SettingsFeedback>
    );
  }
  return (
    <p role="status" className="provider-cli-catalog-source text-ui-caption text-(--ui-text-muted)">
      {receipt?.status === "fresh"
        ? t("Model list refreshed from the CLI. Account access is not checked.")
        : t("Model list from the CLI. Not rechecked in this session.")}
    </p>
  );
}
