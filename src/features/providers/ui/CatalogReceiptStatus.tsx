import { useSyncExternalStore } from "react";
import { t, useLocale, formatDate } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { RefreshCw } from "../../../shared/ui/icons";
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
  if (!available)
    return <SettingsFeedback state="warning">{t("Available after CLI setup")}</SettingsFeedback>;
  const refreshing = receipt?.status === "refreshing";
  const retry = (label: string) => (
    <Button
      size="sm"
      variant="ghost"
      disabled={refreshing}
      loading={refreshing}
      startIcon={<RefreshCw className="icon-sm" strokeWidth={1.75} aria-hidden />}
      aria-label={t("{p0} for {p1} models", { p0: label, p1: HARNESS_TITLE[harness] })}
      onClick={() => {
        refreshProviderCatalog(harness, { force: true }).catch(() => undefined);
      }}
    >
      {label}
    </Button>
  );

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
  if (receipt?.status === "bundled")
    return (
      <SettingsFeedback state="warning" action={retry(t("Refresh"))}>
        {t("Showing the built-in model list. It was not discovered from the CLI.")}
      </SettingsFeedback>
    );
  return null;
}

/** Quiet refresh with last-check provenance. */
export function CatalogRefreshButton({ harness }: { harness: HarnessId }) {
  useLocale();
  useSyncExternalStore(
    subscribeCatalogReceipts,
    getCatalogReceiptsSnapshot,
    getCatalogReceiptsSnapshot,
  );
  const receipt = getCatalogReceipt(harness);
  const previous = receipt?.status === "refreshing" ? receipt.previous : receipt;
  const at = previous && "at" in previous ? previous.at : undefined;
  return (
    <Button
      size="sm"
      variant="ghost"
      iconOnly
      label={t("Refresh")}
      tooltip={
        at
          ? `${t("Refresh")} · ${t("Last checked: {p0}", { p0: formatDate(at, { dateStyle: "short", timeStyle: "short" }) })}`
          : t("Refresh")
      }
      loading={receipt?.status === "refreshing"}
      disabled={receipt?.status === "refreshing"}
      onClick={() => {
        refreshProviderCatalog(harness, { force: true }).catch(() => undefined);
      }}
      startIcon={<RefreshCw className="icon-sm" />}
    />
  );
}
