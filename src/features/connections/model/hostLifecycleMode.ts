import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t } from "../../../shared/i18n";
import { errorText } from "../../../shared/lib/errors";

/** `app`: the Host starts and stops with bycoda. `service`: a login service keeps it running. */
export type HostLifecycleMode = "app" | "service";

/** What `local_host_mode` and `local_host_set_mode` return. */
export type HostModeStatus = {
  mode: HostLifecycleMode;
  registered: boolean;
  /** The saved mode and the real service registration disagree. */
  mismatch: boolean;
  /** An older installed Host cannot switch modes. */
  switchSupported: boolean;
  /** A switch waiting for running sessions to finish. */
  pendingMode?: HostLifecycleMode | null;
  lastError?: string | null;
};

export type HostModeSwitchView = {
  /** On means the Host keeps running when bycoda is closed. */
  checked: boolean;
  pending?: HostLifecycleMode;
  /** The older Host cannot change mode. */
  unsupported: boolean;
  error?: string;
};

/** The switch's states, derived once so the UI only renders them. */
export function hostModeSwitchView(status: HostModeStatus): HostModeSwitchView {
  const error =
    status.lastError ||
    (status.mismatch
      ? t("This computer's host service does not match its saved setting. Switch it again to repair.")
      : undefined);
  return {
    checked: status.mode === "service",
    pending: status.pendingMode ?? undefined,
    unsupported: status.switchSupported === false,
    ...(error ? { error } : {}),
  };
}

/** Asks the desktop to move this computer's Host to `mode`. With `force` running work is
 * interrupted; without it the switch waits for idle and `pendingMode` reports it. */
export function setHostLifecycleMode(
  mode: HostLifecycleMode,
  force: boolean,
): Promise<HostModeStatus> {
  return invoke<HostModeStatus>("local_host_set_mode", { mode, force });
}

const PENDING_POLL_MS = 5_000;

/** This computer's lifecycle mode. `status` stays undefined when the desktop has no
 * switchable Host (a development profile), so the caller renders nothing. */
export function useHostLifecycleMode() {
  const [status, setStatus] = useState<HostModeStatus>();
  const [switching, setSwitching] = useState(false);
  const [failure, setFailure] = useState<string>();
  const waiting = Boolean(status?.pendingMode);
  const read = () =>
    invoke<HostModeStatus>("local_host_mode").then(
      (next) => setStatus(next),
      () => undefined,
    );
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Reads the native registration on mount and window focus, and polls while a switch waits for idle; the desktop owns that state.
  useEffect(() => {
    void read();
    const onFocus = () => void read();
    window.addEventListener("focus", onFocus);
    const timer = waiting ? window.setInterval(onFocus, PENDING_POLL_MS) : undefined;
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [waiting]);
  const apply = async (mode: HostLifecycleMode, force: boolean) => {
    if (switching) return;
    setSwitching(true);
    setFailure(undefined);
    try {
      setStatus(await setHostLifecycleMode(mode, force));
    } catch (reason) {
      setFailure(t(errorText(reason)));
      await read();
    } finally {
      setSwitching(false);
    }
  };
  return { status, switching, failure, apply };
}

/** The success notice for an SSH setup, plus a sentence when setup also turned on the machine's
 * login service (owner decision: setup means "reach this machine", so it stays reachable). */
export function sshSetupSuccessNotice(
  notice: string,
  setup: { enabledBackgroundService?: boolean },
  machineName: string,
): string {
  if (!setup.enabledBackgroundService) return notice;
  return `${notice} ${t("{p0} was set to stay reachable when bycoda is closed.", { p0: machineName })}`;
}
