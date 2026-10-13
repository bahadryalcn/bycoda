import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Modal } from "../../../shared/ui/Modal";
import { SecondaryButton } from "../../../shared/ui/SecondaryButton";
import { featureHost } from "../model/hostFeatureClient";
import { tunnelUiIssue } from "../model/externalTunnelController";
import type { RemoteMachine } from "../model/protocol";
import { TunnelControls } from "./ExternalTunnelsPanel";

/** Resolve through the project's existing host routing, with no local fallback. */
export function ProjectTunnelDialog({
  cwd,
  localUrl,
  onClose,
}: {
  cwd: string;
  localUrl: string;
  onClose: () => void;
}) {
  useLocale();
  const [machine, setMachine] = useState<RemoteMachine>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [update, setUpdate] = useState(false);
  useEffect(() => {
    let alive = true;
    setMachine(undefined);
    setError(false);
    void featureHost(cwd, "tunnels.manage")
      .then((host) => {
        if (alive) setMachine(host.machine);
      })
      .catch((cause) => {
        if (alive) {
          setError(true);
          setUpdate(tunnelUiIssue(cause) === "host-update");
        }
      });
    return () => {
      alive = false;
    };
  }, [cwd, retry]);
  return (
    <Modal title={t("External tunnels")} size="md" onClose={onClose}>
      {machine ? (
        <TunnelControls
          key={`${machine.id}:${machine.environmentId}`}
          machine={machine}
          initialLocalUrl={localUrl}
        />
      ) : error ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-[13px] text-red-400">
            {t(
              update
                ? "Update bycoda Host on this computer to manage external tunnels."
                : "The selected computer could not be reached. Reconnect it and check again.",
            )}
          </p>
          <SecondaryButton onClick={() => setRetry((value) => value + 1)}>
            {t("Check again")}
          </SecondaryButton>
        </div>
      ) : (
        <p role="status">{t("Checking tunnel access…")}</p>
      )}
    </Modal>
  );
}
