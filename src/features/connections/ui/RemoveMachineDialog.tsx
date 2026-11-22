import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { isLocalSyncMachine } from "../model/localSync";
import type { RemoteMachine } from "../model/protocol";

const UNIX_SERVICE_COMMAND = "~/.bycoda-host/bin/bycoda-host service uninstall";
const WINDOWS_SERVICE_COMMAND =
  "%USERPROFILE%\\.bycoda-host\\bin\\bycoda-host.cmd service uninstall";

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
            variant="primary"
            tone={mode === "revoke" ? "danger" : undefined}
            loading={revoking}
            onClick={() => onConfirm(mode === "revoke")}
          >
            {t("Remove")}
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
        <div className="flex items-start justify-between gap-2">
          <RadioGroup
            label={t("Remove")}
            value={mode}
            onValueChange={(next) => onModeChange(next === "revoke" ? "revoke" : "local")}
            options={[
              { value: "local", label: t("Remove from this desktop only"), disabled: revoking },
              { value: "revoke", label: t("Revoke access and remove"), disabled: revoking },
            ]}
          />
          <InfoPopover>
            <p>
              {t(
                "Removing alone leaves this desktop’s credential valid on the host. Revoke access to invalidate it first; the machine must be reachable.",
              )}
            </p>
          </InfoPopover>
        </div>
        <Disclosure variant="row" summary={t("Stop the host on that machine")}>
          <div className="flex flex-col gap-2">
            <Text as="p" tone="muted" leading="relaxed">
              {renderCodeSentence(
                t(
                  "To stop the host and turn off its background service, run {p0} on that machine ({p1} on Windows). Its sessions and history are kept.",
                ),
                { p0: UNIX_SERVICE_COMMAND, p1: WINDOWS_SERVICE_COMMAND },
              )}
            </Text>
            <div className="flex flex-wrap gap-2">
              <CopyButton label={t("Copy for macOS or Linux")} text={UNIX_SERVICE_COMMAND} />
              <CopyButton label={t("Copy for Windows")} text={WINDOWS_SERVICE_COMMAND} />
            </div>
          </div>
        </Disclosure>
        {error ? (
          <Alert
            tone="danger"
            title={t("Couldn’t remove {p0}", { p0: machine.name })}
            extra={cause ? <ErrorDetails detail={cause} /> : undefined}
          >
            {reason}
          </Alert>
        ) : null}
      </div>
    </Modal>
  );
}

/** Renders a translated sentence whose {pN} slots are inline code, keeping the slot in the message. */
function renderCodeSentence(message: string, code: Record<string, string>) {
  return message.split(/(\{p\d+\})/).map((part, index) => {
    const slot = /^\{(p\d+)\}$/.exec(part)?.[1];
    return slot ? <Code key={index}>{code[slot]}</Code> : part;
  });
}
