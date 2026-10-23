import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Play, X } from "../../../shared/ui/icons";
import { startLocalHost, useLocalHostState } from "../model/localHostService";

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
      onError?.(t(reason instanceof Error ? reason.message : String(reason)));
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

  // Show it again the next time the host stops.
  useEffect(() => {
    if (state !== "stopped") {
      setHidden(false);
      setError(undefined);
    }
  }, [state]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    setError(undefined);
    try {
      await startLocalHost();
      setHidden(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  };
  return {
    visible: state === "stopped" && !hidden,
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
  return (
    <Alert role="alert" tone="warning">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("The host on this computer is not running.")}</p>
        <p className="ui-secondary-text mbs-0.5 leading-relaxed">
          {notice.error
            ? t(notice.error)
            : t("Tasks, sessions and sync on this computer are unavailable until it starts.")}
        </p>
        <Button
          className="mbs-2"
          variant="secondary"
          size="sm"
          loading={notice.starting}
          loadingLabel={t("Starting host…")}
          startIcon={<Play className="icon-sm" aria-hidden />}
          onClick={() => void notice.start()}
        >
          {t("Start host")}
        </Button>
      </div>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Dismiss")}
        tooltip={t("Dismiss")}
        onClick={notice.dismiss}
      >
        <X className="icon-sm" aria-hidden />
      </Button>
    </Alert>
  );
}
