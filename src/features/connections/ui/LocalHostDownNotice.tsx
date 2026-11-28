import { Alert } from "../../../shared/ui/Alert";
import { useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Play } from "../../../shared/ui/icons";
import { startLocalHost, useLocalHostState } from "../model/localHostService";
import { errorText } from "../../../shared/lib/errors";

/** Starts this computer's stopped host; reports the reason when it cannot. */
export function LocalHostStartButton({
  className,
  onStarted,
  onError,
}: {
  className?: string;
  onStarted?: () => void;
  onError?: (message: string | undefined) => void;
}) {
  useLocale();
  const [starting, setStarting] = useState(false);
  const start = async () => {
    setStarting(true);
    onError?.(undefined);
    try {
      await startLocalHost();
      onStarted?.();
    } catch (reason) {
      onError?.(errorText(reason));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Button
      className={className}
      variant="secondary"
      size="sm"
      loading={starting}
      loadingLabel={t("Starting host…")}
      startIcon={<Play className="icon-sm" aria-hidden />}
      onClick={() => void start()}
    >
      {t("Start host")}
    </Button>
  );
}

/** Keep the notification count and card in sync, even while the panel is closed. */
export function useLocalHostDownNotice() {
  const state = useLocalHostState();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);

  const [seenState, setSeenState] = useState(state);
  // Show it again the next time the host stops (adjusted during render); a dismissed update
  // notice does not hide a stop that follows it.
  if (seenState !== state) {
    setSeenState(state);
    if (state !== "stopped" || seenState === "updating") {
      setHidden(false);
      setError(undefined);
    }
  }

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(undefined);
    try {
      // The service publishes the real state, which hides the notice; a host that stops again
      // is shown again because nothing here keeps it dismissed.
      await startLocalHost();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setStarting(false);
    }
  };
  return {
    // An update stops the Host on purpose; saying so explains why everything on this computer
    // fails meanwhile.
    visible: (state === "stopped" || state === "updating") && !hidden,
    updating: state === "updating",
    dismiss: () => setHidden(true),
    error,
    starting,
    start,
  };
}

/** An actionable host warning inside the shared notification panel. */
export function LocalHostDownNotice({
  notice,
}: {
  notice: ReturnType<typeof useLocalHostDownNotice>;
}) {
  useLocale();
  if (notice.updating)
    return (
      <Alert
        open
        tone="info"
        title={t("Updating the host on this computer…")}
        dismissLabel={t("Dismiss")}
        onDismiss={notice.dismiss}
      >
        {t("Everything returns in about a minute.")}
      </Alert>
    );
  return (
    <Alert
      // Controlled: dismissing removes the notice at once; the owner hides the row itself.
      open
      tone="warning"
      title={t("The host on this computer is not running.")}
      action={{
        label: t("Start host"),
        onClick: () => void notice.start(),
        pending: notice.starting,
      }}
      dismissLabel={t("Dismiss")}
      onDismiss={notice.dismiss}
      extra={
        notice.error ? (
          <ErrorDetails
            title={t("The host on this computer could not be started.")}
            detail={notice.error}
          />
        ) : undefined
      }
    >
      {notice.error
        ? t("The host on this computer could not be started.")
        : t("Tasks, sessions and sync on this computer are unavailable until it starts.")}
    </Alert>
  );
}
