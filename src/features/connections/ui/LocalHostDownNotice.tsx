import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { t, useLocale } from "../../../shared/i18n";
import { LAYER } from "../../../shared/lib/layers";
import { Button } from "../../../shared/ui/Button";
import { CircleAlert, RefreshCw, X } from "../../../shared/ui/icons";
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
      variant="primary"
      size="sm"
      loading={starting}
      loadingLabel={t("Starting host…")}
      startIcon={<RefreshCw className="size-3.5" aria-hidden />}
      onClick={() => void start()}
    >
      {t("Start host")}
    </Button>
  );
}

/** App-wide: this computer's host stopped, so its tasks, sessions and sync are
 * unavailable until it runs again. Starting it never interrupts running work. */
export function LocalHostDownNotice() {
  useLocale();
  const state = useLocalHostState();
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState<string>();

  // Show it again the next time the host stops.
  useEffect(() => {
    if (state !== "stopped") {
      setHidden(false);
      setError(undefined);
    }
  }, [state]);

  if (state !== "stopped" || hidden) return null;
  return createPortal(
    <section
      role="alert"
      style={{ zIndex: LAYER.toast }}
      className="fixed right-3 bottom-3 flex w-[min(360px,calc(100vw-24px))] gap-2.5 rounded-xl border border-stroke bg-surface px-3 py-2.5 text-[12px] text-content shadow-xl"
    >
      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{t("The host on this computer is not running.")}</p>
        <p className="ui-secondary-text mt-0.5 leading-relaxed">
          {error ?? t("Tasks, sessions and sync on this computer are unavailable until it starts.")}
        </p>
        <LocalHostStartButton
          className="mt-2"
          onStarted={() => setHidden(true)}
          onError={setError}
        />
      </div>
      <Button
        iconOnly
        variant="ghost"
        size="sm"
        label={t("Dismiss")}
        tooltip={t("Dismiss")}
        onClick={() => setHidden(true)}
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </section>,
    document.body,
  );
}
