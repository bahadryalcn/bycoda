import { t, useLocale } from "../../../shared/i18n";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { useSyncStatus } from "../../sync/model/useSyncStatus";
import { summarizeSync } from "../model/syncSummary";

export function ConnectionSyncLine({
  machineId,
  onSyncNow,
}: {
  machineId: string;
  onSyncNow?: () => void;
}) {
  useLocale();
  const sync = useSyncStatus(machineId);
  const { tone, text } = summarizeSync(sync, wallClockNow());
  return (
    <div className="connection-sync" data-sync-tone={tone}>
      {tone === "muted" ? (
        <span className="min-w-0 text-(--ui-text-muted)">{text}</span>
      ) : (
        <InlineMessage
          tone={tone}
          live="off"
          retry={
            onSyncNow && sync.state === "error"
              ? { onRetry: onSyncNow, label: t("Sync now") }
              : undefined
          }
        >
          {text}
        </InlineMessage>
      )}
    </div>
  );
}
