import { LoadingText } from "../../../shared/ui/LoadingText";
import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n/technical";
import { Modal } from "../../../shared/ui/Modal";
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
  const [loading, setLoading] = useState(true);
  const pending = useRef(false);
  const scope = useRef(cwd);
  useEffect(() => {
    let alive = true;
    pending.current = true;
    setLoading(true);
    setMachine(undefined);
    if (scope.current !== cwd) setError(false);
    scope.current = cwd;
    void featureHost(cwd, "tunnels.manage")
      .then((host) => {
        if (alive) {
          setMachine(host.machine);
          setError(false);
        }
      })
      .catch((cause) => {
        if (alive) {
          setError(true);
          setUpdate(tunnelUiIssue(cause) === "host-update");
        }
      })
      .finally(() => {
        if (alive) {
          pending.current = false;
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [cwd, retry]);
  return (
    <Modal title={t("Create link")} size="md" onClose={onClose}>
      {machine ? (
        <TunnelControls
          key={`${machine.id}:${machine.environmentId}`}
          machine={machine}
          initialLocalUrl={localUrl}
        />
      ) : error ? (
        <Alert
          tone="danger"
          action={{
            label: t("Check again"),
            ariaLabel: t("Check again"),
            pending: loading,
            onClick: () => {
              if (pending.current) return;
              pending.current = true;
              setLoading(true);
              setRetry((value) => value + 1);
            },
          }}
        >
          {t(
            update
              ? "Update bycoda Host on this computer to manage external tunnels."
              : "The selected computer could not be reached.",
          )}
        </Alert>
      ) : (
        <LoadingText>{t("Checking tunnel access…")}</LoadingText>
      )}
    </Modal>
  );
}
