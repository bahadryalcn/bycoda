import { useSyncExternalStore } from "react";
import { t, useLocale, formatDate, formatNumber } from "../../../shared/i18n";
import { redactDiagnosticText } from "@bycoda/account-contracts";
import { stripAnsi } from "../../../shared/lib/ansi";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { RefreshCw } from "../../../shared/ui/icons";
import { type HarnessId } from "../../sessions/model/session";
import { SettingsFeedback } from "../../../shared/ui/settings";
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
  const retry = (label: string) => ({
    label,
    pending: refreshing,
    onClick: () => {
      refreshProviderCatalog(harness, { force: true }).catch(() => undefined);
    },
  });

  if (receipt?.status === "error") {
    // The sentence is fixed and translated; the provider's raw text stays behind Details.
    const count = formatNumber(receipt.count);
    const summary = receipt.retained
      ? t("Could not refresh models. Showing the earlier list ({p0}).", { p0: count })
      : t("Could not refresh models. Showing the built-in list ({p0}).", { p0: count });
    const detail = redactDiagnosticText(stripAnsi(receipt.error)).trim();
    return (
      <SettingsFeedback
        state="error"
        action={retry(t("Retry"))}
        extra={detail ? <ErrorDetails title={summary} detail={detail} /> : undefined}
      >
        {summary}
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
