import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { UpdateImpact } from "./UpdateImpact";
import { hostRestartConsequences } from "./hostRestartConsequences";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { buildIdentity } from "../../../shared/model/build-info";
import { remoteRequest } from "../model/connections";
import { localHostCompatibility } from "../model/buildCompatibility";
import type { HostDescriptor, RemoteMachine } from "../model/protocol";
import { updateBundledHostNow, useBundledHostStatus } from "../model/bundledHostStatus";
import { localHostNotice, type LocalHostCompatibility } from "../model/localHostNotice";
import { errorText } from "../../../shared/lib/errors";

/**
 * Explains a host update the app could not apply yet and lets the owner install it now,
 * after confirming that running work is interrupted; silent when the host is verified current.
 */
export function LocalHostUpdateNotice() {
  useLocale();
  const status = useBundledHostStatus();
  const { confirm, dialog } = useConfirm();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string>();
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
  const updateNow = async () => {
    if (updating) return;
    const approved = await confirm({
      title: t("Update this computer's host now?"),
      message: t("The host restarts to install the version included in this app."),
      consequences: hostRestartConsequences(),
      confirmLabel: t("Stop and update"),
      danger: true,
      body: <UpdateImpact target="local-host" />,
    });
    if (!approved) return;
    setUpdating(true);
    setError(undefined);
    try {
      await updateBundledHostNow();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setUpdating(false);
    }
  };
  return (
    <>
      <Alert
        tone={notice.tone}
        title={t(notice.title)}
        action={
          notice.canUpdateNow
            ? { label: t("Update host now"), onClick: () => void updateNow(), pending: updating }
            : undefined
        }
      >
        {[...notice.details.map((line) => t(line.text, line.params)), error ? t(error) : ""]
          .filter(Boolean)
          .join(" ")}
      </Alert>
      {dialog}
    </>
  );
}
