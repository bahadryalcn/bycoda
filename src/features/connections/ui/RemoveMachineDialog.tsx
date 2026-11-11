import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { isLocalSyncMachine } from "../model/localSync";
import type { RemoteMachine } from "../model/protocol";

export function RemoveMachineDialog({
  machine,
  mode,
  revoking,
  error,
  onModeChange,
  onCancel,
  onConfirm,
}: {
  machine: RemoteMachine;
  mode: "revoke" | "local";
  revoking: boolean;
  error: string;
  onModeChange: (mode: "revoke" | "local") => void;
  onCancel: () => void;
  onConfirm: (revoke: boolean) => void;
}) {
  return (
    <Modal
      onClose={() => {
        if (!revoking) onCancel();
      }}
      title={t("Remove {p0} from this desktop?", { p0: machine.name })}
      size="md"
      footer={
        <ModalActions>
          <Button stableWidth type="button" variant="ghost" disabled={revoking} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            stableWidth
            type="button"
            variant="danger"
            loading={revoking}
            onClick={() => onConfirm(mode === "revoke")}
          >
            {mode === "revoke" ? t("Revoke access and remove") : t("Remove from this desktop only")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex flex-col gap-3 text-ui-caption leading-relaxed text-(--ui-text-muted)">
        {isLocalSyncMachine(machine) ? (
          <p>
            {t("Removing this stops syncing projects and groups with the")}{" "}
            {PRODUCT_IDENTITY.displayName}
            {t(" on this computer. It is created again automatically the next time")}{" "}
            {PRODUCT_IDENTITY.displayName}
            {t(" starts.")}
          </p>
        ) : (
          <p>
            {t(
              "This closes this desktop’s connection to the machine. It does not stop the host, and its sessions keep running and stay on that machine. You can add it again later.",
            )}
          </p>
        )}
        <RadioGroup
          label={t("Remove")}
          value={mode}
          onValueChange={(next) => onModeChange(next === "revoke" ? "revoke" : "local")}
          options={[
            {
              value: "local",
              label: t("Remove from this desktop only"),
              description: t(
                "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
              ),
              disabled: revoking,
            },
            {
              value: "revoke",
              label: t("Revoke access and remove"),
              disabled: revoking,
            },
          ]}
        />
        <div>
          <p>
            {t("To stop the host and turn off its background service, run")}{" "}
            <code>{"~/.bycoda-host/bin/bycoda-host service uninstall"}</code>{" "}
            {t("on that machine (")}
            <code>
              {"%USERPROFILE%\\.bycoda-host\\bin\\bycoda-host.cmd service uninstall"}
            </code>{" "}
            {t("on Windows). Its sessions and history are kept.")}
          </p>
        </div>
        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
