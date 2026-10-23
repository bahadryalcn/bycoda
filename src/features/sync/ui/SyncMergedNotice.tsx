import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState } from "react";
import { SYNC_MERGED_MESSAGE, subscribeSyncMerged } from "../model/syncClient";
import { TransientNotice } from "../../../shared/ui/TransientNotice";

const VISIBLE_MS = 5000;

export function SyncMergedNotice() {
  useLocale();
  // Each merge restarts the notice: a new key remounts it and resets its timer.
  const [shown, setShown] = useState<number | null>(null);

  useEffect(
    () =>
      subscribeSyncMerged(() => {
        setShown((count) => (count ?? 0) + 1);
      }),
    [],
  );

  if (shown === null) return null;
  return (
    <TransientNotice
      key={shown}
      tone="info"
      aria-label={t("Sync notice")}
      message={SYNC_MERGED_MESSAGE}
      durationMs={VISIBLE_MS}
      onDismiss={() => setShown(null)}
    />
  );
}
