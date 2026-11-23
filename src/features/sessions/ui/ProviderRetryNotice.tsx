import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { InlineError } from "../../../shared/ui/InlineError";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { sessionRetryNotice } from "../model/sessionIssue";

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
  const refresh = () => {
    if (!onRefresh || pending.current) return Promise.resolve();
    return runRefresh(onRefresh, pending, setRefreshing, setRefreshFailed);
  };
  return (
    <div className="flex flex-col gap-1">
      <InlineMessage
        tone="warning"
        action={
          onRefresh
            ? {
                label: refreshing ? t("Refreshing…") : t("Refresh status"),
                pending: refreshing,
                onClick: () => void refresh(),
              }
            : { label: t("Stop"), onClick: onStop }
        }
        secondaryAction={
          onRefresh ? { label: t("Stop"), disabled: refreshing, onClick: onStop } : undefined
        }
      >
        <span className="min-w-0 break-words">
          <Text size="inherit" tone="neutral" weight="medium">
            {t(notice.reconnecting ? "Reconnecting to {p0}" : "{p0} is retrying", { p0: provider })}
          </Text>
          {notice.detail ? <> · {notice.detail}</> : null}
        </span>
      </InlineMessage>
      {refreshFailed ? (
        <InlineError>
          {t(
            "Could not refresh the conversation. Check the host connection and try Refresh status again.",
          )}
        </InlineError>
      ) : null}
    </div>
  );
}
