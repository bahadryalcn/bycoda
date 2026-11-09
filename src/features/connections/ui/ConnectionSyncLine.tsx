import { t, useLocale } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { describeSyncStatus } from "../../sync/model/syncStatusText";
import { useSyncStatus } from "../../sync/model/useSyncStatus";

export function ConnectionSyncLine({ machineId }: { machineId: string }) {
  useLocale();
  const sync = useSyncStatus(machineId);
  const failed = sync.state === "error";
  return (
    <div className="connection-sync">
      {failed ? (
        <Disclosure
          size="sm"
          className="connection-sync-error"
          summary={
            <>
              {t("Sync needs attention")}
              {sync.pendingOps > 0
                ? ` · ${t("{p0} pending changes", { p0: sync.pendingOps })}`
                : ""}
            </>
          }
        >
          <p>{describeSyncStatus(sync, Date.now())}</p>
        </Disclosure>
      ) : (
        <span className="min-w-0 text-(--ui-text-muted)">
          {sync.state === "ok" && sync.lastSyncAt
            ? t("Synced {p0} min ago", {
                p0: Math.max(0, Math.floor((Date.now() - sync.lastSyncAt) / 60_000)),
              }) +
              (sync.pendingOps ? ` · ${t("{p0} pending changes", { p0: sync.pendingOps })}` : "")
            : describeSyncStatus(sync, Date.now())}
        </span>
      )}
    </div>
  );
}
