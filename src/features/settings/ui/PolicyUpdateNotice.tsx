import { useEffect, useState, useSyncExternalStore } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { formatDate, t, useLocale } from "../../../shared/i18n";
import {
  bundledPolicyUpdate,
  policyDocumentUrl,
  policyUpdateIntervalMs,
  policyUpdateStorageKey,
  readPolicyUpdate,
} from "../../../shared/lib/policyUpdates";
import { createStoredSetting } from "../../../shared/lib/storedSetting";
import { Toast } from "../../../shared/ui/ToastRegion";

const seen = createStoredSetting({
  key: policyUpdateStorageKey,
  fallback: 0,
  parse: Number,
  serialize: String,
  event: "bycoda:policy-update-seen",
  storageEvents: true,
});

export function PolicyUpdateNotice() {
  const locale = useLocale();
  const [update, setUpdate] = useState(bundledPolicyUpdate);
  const [dismissed, setDismissed] = useState(0);
  const lastSeen = useSyncExternalStore(seen.subscribe, seen.load);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Holds the public revision refresh timer and visibility listener while this workspace is mounted.
  useEffect(() => {
    const lifetime = new AbortController();
    let lastCheck = 0;
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - lastCheck < policyUpdateIntervalMs)
        return;
      lastCheck = Date.now();
      readPolicyUpdate(lifetime.signal)
        .then((next) => {
          if (next && !lifetime.signal.aborted)
            setUpdate((current) => (current && current.revision >= next.revision ? current : next));
        })
        .catch(() => undefined);
    };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    const timer = setInterval(refresh, policyUpdateIntervalMs);
    return () => {
      lifetime.abort();
      document.removeEventListener("visibilitychange", refresh);
      clearInterval(timer);
    };
  }, []);

  if (!update || update.revision <= lastSeen || update.revision <= dismissed) return null;
  const dismiss = () => {
    setDismissed(update.revision);
    seen.save(Math.max(seen.load() || 0, update.revision));
  };
  return (
    <Toast
      tone="info"
      title={t("Policies")}
      message={`${formatDate(new Date(update.publishedOn), { dateStyle: "long", timeZone: "UTC" })} · ${locale === "tr" ? update.tr : update.en}`}
      durationMs={null}
      width="lg"
      actionsPlacement="footer"
      actions={update.documents.map((document) => ({
        label: document === "privacy" ? t("Privacy policy") : t("Terms of use"),
        onClick: () => openExternal(policyDocumentUrl(document)).catch(() => undefined),
      }))}
      action={{ label: t("Dismiss"), onClick: dismiss }}
      onDismiss={dismiss}
    />
  );
}
