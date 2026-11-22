import { Text } from "../../../shared/ui/Text";
import { t, useLocale } from "../../../shared/i18n";
import { wallClockNow } from "../../../shared/lib/time/wallClock";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { useSyncStatus } from "../../sync/model/useSyncStatus";
import { summarizeSync } from "../model/syncSummary";
import { useGracedFailure } from "../model/transientFailure";

export function ConnectionSyncLine({
  machineId,
  onSyncNow,
}: {
  machineId: string;
  onSyncNow?: () => void;
}) {
  useLocale();
  const sync = useSyncStatus(machineId);
  // Sync owns journal/retry authority. This line only controls when its error is visible.
  const failure = useGracedFailure({
    error: sync.state === "error" ? sync.lastError : undefined,
    loading: sync.state === "syncing",
    scope: machineId,
  });
  const { tone, text } = summarizeSync(sync, wallClockNow(), failure.pending);
  return (
    <Text
      as="div"
      size="caption"
      tone="inherit"
      leading="inherit"
      className="connection-sync"
      data-sync-tone={tone}
      aria-busy={failure.pending || undefined}
    >
      {tone === "muted" ? (
        <Text size="inherit" tone="muted" className="min-w-0">
          {text}
        </Text>
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
    </Text>
  );
}
