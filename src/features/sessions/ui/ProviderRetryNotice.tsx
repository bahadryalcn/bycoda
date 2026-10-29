import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { sessionRetryNotice } from "../model/sessionIssue";

/** Recovery actions inspect or stop the current turn; they never resend it. */
export function ProviderRetryNotice({
  provider,
  message,
  onStop,
  onRefresh,
}: {
  provider: string;
  message: string;
  onStop: () => void;
  onRefresh?: () => Promise<unknown>;
}) {
  const t = useT();
  const notice = sessionRetryNotice(message);
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = async () => {
    if (!onRefresh || pending.current) return;
    pending.current = true;
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      await onRefresh();
    } catch {
      setRefreshFailed(true);
    } finally {
      pending.current = false;
      setRefreshing(false);
    }
  };
  return (
    <div className="shrink-0 px-4 py-1.5 text-ui-caption">
      <Alert
        tone="warning"
        inline
        action={
          <>
            {onRefresh ? (
              <Button variant="secondary" loading={refreshing} onClick={() => void refresh()}>
                {refreshing ? t("Refreshing…") : t("Refresh status")}
              </Button>
            ) : null}
            <Button variant="secondary" disabled={refreshing} onClick={onStop}>
              {t("Stop")}
            </Button>
          </>
        }
      >
        <span className="min-w-0 break-words">
          <span className="font-medium text-(--ui-tone-neutral-fg)">
            {t(notice.reconnecting ? "Reconnecting to {p0}" : "{p0} is retrying", { p0: provider })}
          </span>
          {notice.detail ? <> · {notice.detail}</> : null}
          <span className="block">
            {t(
              "Retrying automatically. If this stays here, stop the turn and review its latest output before continuing.",
            )}
          </span>
        </span>
      </Alert>
      {refreshFailed ? (
        <Alert tone="danger" inline role="alert" className="mt-1">
          {t(
            "Could not refresh the conversation. Check the host connection and try Refresh status again.",
          )}
        </Alert>
      ) : null}
    </div>
  );
}
