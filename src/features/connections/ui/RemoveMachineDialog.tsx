import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { useSyncExternalStore } from "react";
import { isLocalSyncMachine } from "../model/localSync";
import { isPairingRefused } from "../model/remoteConnection";
import { readRemoteConnection, subscribeChanges } from "../model/remoteHealth";
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
  // A failure is "reason" + blank line + "cause": the reason is the body, the cause waits behind Details.
  const [reason, ...rest] = error.split("\n\n");
  const cause = rest.join("\n\n").trim();
  const localSync = isLocalSyncMachine(machine);
  // A machine that already refuses this desktop's credential has nothing left to revoke.
  const refused = useSyncExternalStore(subscribeChanges, () =>
    isPairingRefused(readRemoteConnection(machine.environmentId)),
  );
  return (
    <Modal
      onClose={() => {
        if (!revoking) onCancel();
      }}
      title={t("Remove {p0} from this desktop?", { p0: machine.name })}
      size="md"
      footer={
        <ModalActions>
          <Button
            stableWidth
            type="button"
            variant="ghost"
            disabled={revoking}
            disabledReason={revoking ? t("Removal is in progress.") : undefined}
            onClick={onCancel}
          >
            {t("Cancel")}
          </Button>
          <Button
            stableWidth
            type="button"
            variant="primary"
            tone={mode === "revoke" ? "danger" : undefined}
            loading={revoking}
            onClick={() => onConfirm(mode === "revoke" && !refused)}
          >
            {mode === "revoke" && !refused
              ? t("Revoke access and remove")
              : t("Remove from this desktop only")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex flex-col gap-3">
        <Text as="p" tone="muted" leading="relaxed">
          {localSync
            ? t(
                "Removing this stops syncing projects and groups with the {p0} on this computer. It is created again automatically the next time {p1} starts.",
                { p0: PRODUCT_IDENTITY.displayName, p1: PRODUCT_IDENTITY.displayName },
              )
            : t("The host and its sessions keep running. You can add it again later.")}
        </Text>
        <RadioGroup
          label={t("Remove")}
          value={mode}
          onValueChange={(next) => onModeChange(next === "revoke" ? "revoke" : "local")}
          options={[
            {
              value: "local",
              label: t("Remove from this desktop only"),
              description: refused
                ? t("{p0} already refuses this desktop, so nothing stays valid there.", {
                    p0: machine.name,
                  })
                : t(
                    "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
                  ),
              disabled: revoking,
            },
            {
              value: "revoke",
              label: t("Revoke access and remove"),
              disabled: revoking || refused,
              disabledReason: refused
                ? t("{p0} already refuses this desktop. There is no access left to revoke.", {
                    p0: machine.name,
                  })
                : undefined,
            },
          ]}
        />
        {error ? (
          <Alert tone="danger" extra={cause ? <ErrorDetails detail={cause} /> : undefined}>
            {reason}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}
