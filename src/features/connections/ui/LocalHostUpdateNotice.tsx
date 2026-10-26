import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { buildIdentity } from "../../../shared/model/build-info";
import { remoteRequest } from "../model/connections";
import { localHostCompatibility } from "../model/buildCompatibility";
import type { HostDescriptor, RemoteMachine } from "../model/protocol";

type BundledHostStatus = {
  state: string;
  message?: string | null;
  bundled?: string | null;
  installed?: string | null;
};

/** Explains a host update the app could not apply yet; silent when current. */
export function LocalHostUpdateNotice() {
  useLocale();
  const [status, setStatus] = useState<BundledHostStatus | null>(null);
  const [mismatch, setMismatch] = useState<"identity" | "capabilities" | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      invoke<BundledHostStatus | null>("local_host_bundle_status").then(
        (value) => {
          if (!cancelled) setStatus(value);
        },
        () => undefined,
      );
    void load();
    const loadCompatibility = async () => {
      try {
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        const machine = machines.find((entry) => entry.localHost);
        if (!machine) return;
        const descriptor = await remoteRequest<HostDescriptor>(
          machine.id,
          "environment.describe",
          {},
          true,
        );
        if (!cancelled) setMismatch(localHostCompatibility(buildIdentity, descriptor));
      } catch {
        /* An unavailable descriptor is not evidence of a mismatch. */
      }
    };
    void loadCompatibility();
    const timer = window.setInterval(() => {
      void load();
      void loadCompatibility();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const pendingUpdate = status?.state === "deferred" || status?.state === "failed";
  if (!pendingUpdate && !mismatch) return null;
  const versions =
    status?.installed && status.bundled
      ? t("This computer's host is {p0}; this app includes {p1}.", {
          p0: status.installed,
          p1: status.bundled,
        })
      : null;
  return (
    <Alert tone="warning" role="status">
      <span className="font-medium text-content">
        {pendingUpdate
          ? status?.state === "failed"
            ? t("The host on this computer could not be updated.")
            : t("The host on this computer will update soon.")
          : t("The app and this computer's Host need to be updated together.")}
      </span>{" "}
      {versions} {status?.message ? t(status.message) : null}{" "}
      {mismatch === "identity"
        ? t("The serving Host source differs from the Host bundled with this app.")
        : mismatch === "capabilities"
          ? t(
              "The serving Host does not support managed workspace creation and policy. Update the Host before starting work.",
            )
          : null}
    </Alert>
  );
}
