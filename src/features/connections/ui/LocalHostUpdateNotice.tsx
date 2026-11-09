import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { buildIdentity } from "../../../shared/model/build-info";
import { remoteRequest } from "../model/connections";
import { localHostCompatibility } from "../model/buildCompatibility";
import type { HostDescriptor, RemoteMachine } from "../model/protocol";
import { useBundledHostStatus } from "../model/bundledHostStatus";
import { localHostNotice, type LocalHostCompatibility } from "../model/localHostNotice";

/** Explains a host update the app could not apply yet; silent when the host is verified current. */
export function LocalHostUpdateNotice() {
  useLocale();
  const status = useBundledHostStatus();
  const [compatibility, setCompatibility] = useState<LocalHostCompatibility>("pending");
  useEffect(() => {
    let cancelled = false;
    const loadCompatibility = async () => {
      try {
        const machines = await invoke<RemoteMachine[]>("remote_machines");
        const machine = machines.find((entry) => entry.localHost);
        if (!machine) {
          if (!cancelled) setCompatibility("unavailable");
          return;
        }
        const descriptor = await remoteRequest<HostDescriptor>(
          machine.id,
          "environment.describe",
          {},
          true,
        );
        const next = localHostCompatibility(buildIdentity, descriptor) ?? "ok";
        if (!cancelled) setCompatibility(next);
      } catch {
        // An unavailable descriptor is not evidence of a mismatch, and one failed
        // refresh does not undo what an earlier answer already established.
        if (!cancelled)
          setCompatibility((current) => (current === "pending" ? "unavailable" : current));
      }
    };
    void loadCompatibility();
    const onFocus = () => void loadCompatibility();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [status?.installed, status?.bundled]);
  const notice = localHostNotice(status, compatibility);
  if (!notice) return null;
  return (
    <Alert tone={notice.tone}>
      <span className="font-medium text-content">{t(notice.title)}</span>{" "}
      {notice.details.map((line) => t(line.text, line.params)).join(" ")}
    </Alert>
  );
}
