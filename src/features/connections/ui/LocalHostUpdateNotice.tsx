import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { buildIdentity } from "../../../shared/model/build-info";
import { remoteRequest } from "../model/connections";
import { localHostCompatibility } from "../model/buildCompatibility";
import type { HostDescriptor, RemoteMachine } from "../model/protocol";
import { updateBundledHostNow, useBundledHostStatus } from "../model/bundledHostStatus";
import { localHostNotice, type LocalHostCompatibility } from "../model/localHostNotice";

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
      consequences: [
        {
          tone: "warning",
          content: t("Running sessions and shells on this computer are interrupted."),
        },
        { content: t("Session history is kept.") },
      ],
      confirmLabel: t("Stop and update"),
    });
    if (!approved) return;
    setUpdating(true);
    setError(undefined);
    try {
      await updateBundledHostNow();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUpdating(false);
    }
  };
  return (
    <>
      <Alert tone={notice.tone}>
        <div className="min-w-0 flex-1">
          <span className="font-medium text-content">{t(notice.title)}</span>{" "}
          {notice.details.map((line) => t(line.text, line.params)).join(" ")}
          {error ? <p className="mbs-0.5">{t(error)}</p> : null}
          {notice.canUpdateNow ? (
            <div className="mbs-2">
              <Button
                variant="secondary"
                size="sm"
                loading={updating}
                loadingLabel={t("Updating host…")}
                onClick={() => void updateNow()}
              >
                {t("Update host now")}
              </Button>
            </div>
          ) : null}
        </div>
      </Alert>
      {dialog}
    </>
  );
}
