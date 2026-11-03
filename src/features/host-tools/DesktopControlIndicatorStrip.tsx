import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { t } from "../../shared/i18n";
import { DesktopControlStripView } from "./DesktopControlStripView";
import {
  nativeDesktopIndicatorPort,
  type DesktopIndicatorPort,
  type DesktopIndicatorView,
} from "./desktopControlIndicator";
/** Both surfaces mirror one native poller and its immutable original owner channel. */
export function DesktopControlStrip({
  port = nativeDesktopIndicatorPort,
  floating = false,
  onDismiss,
}: {
  port?: DesktopIndicatorPort;
  floating?: boolean;
  onDismiss?: () => void;
}) {
  const [view, setView] = useState<DesktopIndicatorView>();
  const current = useRef<DesktopIndicatorView | undefined>(undefined);
  const [readError, setReadError] = useState(false);
  const [localStopError, setLocalStopError] = useState(false);
  const [shortcutError, setShortcutError] = useState("");
  const shortcutFailureRevision = useRef(-1);
  const [stopping, setStopping] = useState(false);
  const pendingStop = useRef(false);
  useEffect(() => {
    let disposed = false,
      pendingRead = false;
    let unlisten: (() => void) | undefined, shortcut: (() => void) | undefined;
    const adopt = (next: DesktopIndicatorView) => {
      if (disposed || (current.current && next.revision < current.current.revision)) return;
      current.current = next;
      setView(next);
      setReadError(false);
      if (
        next.status?.stopped &&
        !next.status.enabled &&
        !next.status.active &&
        !next.statusError &&
        !next.stopError
      ) {
        setLocalStopError(false);
        if (next.revision > shortcutFailureRevision.current) setShortcutError("");
      }
    };
    const refresh = async () => {
      if (disposed || pendingRead) return;
      pendingRead = true;
      try {
        adopt(await port.read());
      } catch {
        if (!disposed) setReadError(true);
      } finally {
        pendingRead = false;
      }
    };
    void port
      .subscribe(adopt)
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => {
        if (!disposed) setReadError(true);
      });
    void listen<{ ok: boolean }>("desktop_control_shortcut_result", ({ payload }) => {
      if (disposed) return;
      if (!payload.ok) {
        shortcutFailureRevision.current = current.current?.revision ?? 0;
        setShortcutError(t("Computer control could not be stopped. Try again."));
      }
      void refresh();
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else shortcut = cleanup;
      })
      .catch(() => undefined);
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
      unlisten?.();
      shortcut?.();
    };
  }, [port]);
  async function stop() {
    if (pendingStop.current) return;
    pendingStop.current = true;
    setStopping(true);
    setLocalStopError(false);
    try {
      await port.stop();
      const next = await port.read();
      if (!current.current || next.revision >= current.current.revision) {
        current.current = next;
        setView(next);
        setReadError(false);
      }
      if (next.statusError || next.stopError) throw new Error("Unconfirmed Stop");
      setShortcutError("");
    } catch {
      setLocalStopError(true);
    } finally {
      pendingStop.current = false;
      setStopping(false);
    }
  }
  const error =
    (localStopError ? t("Computer control could not be stopped. Try again.") : "") ||
    shortcutError ||
    (view?.stopError
      ? t("Computer control could not be stopped. Try again.")
      : view?.statusError || readError
        ? t("Computer control status is unavailable. Stop remains available.")
        : "");
  if (!floating && !view?.visible && !shortcutError && !stopping) return null;
  return (
    <DesktopControlStripView
      name={view?.status?.assistantName}
      status={view?.status ?? undefined}
      error={error}
      stopping={stopping || view?.stopping}
      unknown={!!error || !view?.status}
      forceVisible={floating}
      floating={floating}
      onStop={() => void stop()}
      onDismiss={onDismiss}
    />
  );
}
