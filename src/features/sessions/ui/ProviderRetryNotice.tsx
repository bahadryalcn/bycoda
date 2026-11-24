import { useRef, useState } from "react";
import { useFormat, useT } from "../../../shared/i18n";
import { useRetryCountdown } from "./useRetryCountdown";
import { InlineError } from "../../../shared/ui/InlineError";
import { sessionRetryNotice } from "../model/sessionIssue";
import { NoticeActionButton, TranscriptNotice } from "./TranscriptNotice";

async function runRefresh(
  onRefresh: () => Promise<unknown>,
  pending: { current: boolean },
  setRefreshing: (value: boolean) => void,
  setRefreshFailed: (value: boolean) => void,
) {
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
}

/** Recovery actions inspect or stop the current turn; they never resend it. */
export function ProviderRetryNotice({
  provider,
  message,
  retryAt,
  onStop,
  onRefresh,
}: {
  provider: string;
  message: string;
  /** Epoch ms of the next attempt when the provider reported it; absent keeps the static text. */
  retryAt?: number;
  onStop: () => void;
  onRefresh?: () => Promise<unknown>;
}) {
  const t = useT();
  const { formatDuration } = useFormat();
  const notice = sessionRetryNotice(message);
  const remaining = useRetryCountdown(retryAt);
  const countdown =
    remaining === undefined
      ? undefined
      : t("Retrying in {p0}", { p0: formatDuration(Math.ceil(remaining / 1000) * 1000) });
  const pending = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const refresh = () => {
    if (!onRefresh || pending.current) return Promise.resolve();
    return runRefresh(onRefresh, pending, setRefreshing, setRefreshFailed);
  };
  return (
    <TranscriptNotice
      kind="retry"
      title={t(notice.reconnecting ? "Reconnecting to {p0}" : "{p0} is retrying", { p0: provider })}
      detail={
        countdown ? (notice.detail ? `${countdown} · ${notice.detail}` : countdown) : notice.detail
      }
      actions={
        <>
          <NoticeActionButton
            action={
              onRefresh
                ? {
                    label: refreshing ? t("Refreshing…") : t("Refresh status"),
                    pending: refreshing,
                    onClick: () => void refresh(),
                  }
                : { label: t("Stop"), onClick: onStop }
            }
          />
          {onRefresh ? (
            <NoticeActionButton
              quiet
              action={{ label: t("Stop"), disabled: refreshing, onClick: onStop }}
            />
          ) : null}
        </>
      }
    >
      {refreshFailed ? (
        <InlineError className="mt-1">
          {t(
            "Could not refresh the conversation. Check the host connection and try Refresh status again.",
          )}
        </InlineError>
      ) : null}
    </TranscriptNotice>
  );
}
