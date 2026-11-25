import { Code } from "../../../shared/ui/Code";
import { Alert } from "../../../shared/ui/Alert";
import { useId } from "react";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ModalActions, ModalFooter } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { TextField } from "../../../shared/ui/TextField";
import { t } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import type { RemoteMachine } from "../model/protocol";

export type MachineMethod = "ssh" | "url";

/** The SSH fields of the add and edit form. Port fields stay strings while typing. */
export interface SshDraft {
  name: string;
  target: string;
  port: string;
  remotePort: string;
  alternate: string;
}

export const EMPTY_SSH_DRAFT: SshDraft = {
  name: "",
  target: "",
  port: "",
  remotePort: "",
  alternate: "",
};

function SshHelp({ editing }: { editing: boolean }) {
  return (
    <InfoPopover label={t("Connection help")} width={360}>
      <p>
        {t("A hostname works too, such as a Mac's Bonjour name (")}
        <Code>{"user@MacBook-Pro.local"}</Code>
        {t(") or an alias from")} <Code>{"~/.ssh/config"}</Code>
        {t(". Then the address does not need editing when the IP changes.")}
      </p>
      {editing ? (
        <p>
          {t(
            "Saving a new address closes the current connection and connects to it. If this computer has not connected to that address before, SSH asks you here whether to trust its host key. The machine's projects, sessions and history stay linked to it. If the address turns out to be another machine, the change stays saved so you can fix it; nothing is installed there.",
          )}
        </p>
      ) : (
        <p>
          {PRODUCT_IDENTITY.displayName}
          {t(
            " installs and starts its background host, then connects securely. Your SSH keys and config are used automatically. Enable SSH on the host and sign in to Codex or Claude Code there. On Windows and Mac, keep the host’s desktop account signed in and the machine awake. Locking the desktop is fine.",
          )}{" "}
          {t(
            "On Linux, setup installs a systemd user service and turns on lingering for your account (",
          )}
          <Code>{"loginctl enable-linger"}</Code>
          {t(
            "), so the host and your other user services keep running after you log out. The host keeps running until you stop it on that machine; removing it here only disconnects this desktop.",
          )}
        </p>
      )}
    </InfoPopover>
  );
}

function SshFields({
  draft,
  editing,
  busy,
  suggestion,
  onChange,
}: {
  draft: SshDraft;
  editing: boolean;
  busy: boolean;
  suggestion: string | undefined;
  onChange: (patch: Partial<SshDraft>) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <TextField
          autoFocus
          required
          disabled={busy}
          value={draft.target}
          onChange={(event) => onChange({ target: event.target.value })}
          placeholder={t("user@my-mac-mini or an SSH alias")}
          autoComplete="off"
          spellCheck={false}
          label={t("SSH address")}
          fieldClassName="min-w-0 flex-1"
        />
        {suggestion && (
          <Button
            stableWidth
            type="button"
            disabled={busy}
            onClick={() => onChange({ target: suggestion })}
            variant="secondary"
            align="start"
          >
            {t("Use {p0} instead of the IP", { p0: suggestion })}
          </Button>
        )}
      </div>
      <TextField
        disabled={busy}
        value={draft.name}
        onChange={(event) => onChange({ name: event.target.value })}
        placeholder={t("Optional, e.g. Home Mac mini")}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        label={t("Name (optional)")}
        fieldClassName="min-w-0 flex-1"
      />
      {editing ? (
        <NumberField
          disabled={busy}
          min={1}
          max={65535}
          name="hostPort"
          value={draft.remotePort}
          onChange={(event) => onChange({ remotePort: event.target.value })}
          label={t("Host port")}
          fieldClassName="min-w-0 flex-1"
        />
      ) : null}
      <Disclosure
        size="sm"
        textSize="caption"
        tone="muted"
        summary={t("More options")}
        defaultOpen={Boolean(draft.alternate)}
      >
        <TextField
          disabled={busy}
          value={draft.alternate}
          onChange={(event) => onChange({ alternate: event.target.value })}
          placeholder={t("Optional, e.g. user@100.64.0.5 (Tailscale)")}
          autoComplete="off"
          spellCheck={false}
          label={t("Other address (optional)")}
          fieldClassName="min-w-0 flex-1"
        />
        <div className="max-w-56">
          <NumberField
            disabled={busy}
            min={1}
            max={65535}
            value={draft.port}
            onChange={(event) => onChange({ port: event.target.value })}
            placeholder={t("From SSH config")}
            label={t("SSH port")}
            fieldClassName="min-w-0 flex-1"
          />
        </div>
      </Disclosure>
    </>
  );
}

/** Add or edit one machine. Editing is SSH only; adding offers SSH or an existing host URL.
 * The parent owns every draft so switching method or closing the form keeps them. */
export function MachineForm({
  editing,
  method,
  onMethodChange,
  draft,
  onDraftChange,
  suggestion,
  url,
  onUrlChange,
  token,
  onTokenChange,
  busy,
  error,
  saveLabel,
  onSubmit,
  onCancel,
}: {
  editing?: RemoteMachine;
  method: MachineMethod;
  onMethodChange: (method: MachineMethod) => void;
  draft: SshDraft;
  onDraftChange: (patch: Partial<SshDraft>) => void;
  suggestion: string | undefined;
  url: string;
  onUrlChange: (url: string) => void;
  token: string;
  onTokenChange: (token: string) => void;
  busy: boolean;
  error: string;
  saveLabel: "Save" | "Save and reconnect";
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const formId = useId();
  // A failure is "reason" + blank line + "cause": the cause waits behind Details.
  const [errorReason = "", ...errorRest] = error.split("\n\n");
  const errorCause = errorRest.join("\n\n").trim();
  const ssh = Boolean(editing) || method === "ssh";
  const title = editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a computer");
  const editAction = saveLabel === "Save" ? t("Save") : t("Save and reconnect");
  const actions = (
    <ModalActions inline={!editing}>
      <Button stableWidth type="button" disabled={busy} onClick={onCancel} variant="ghost">
        {t("Cancel")}
      </Button>
      <Button
        stableWidth
        reserveLabels={[t("Saving…"), t("Connecting…")]}
        loading={busy}
        disabled={busy || (ssh ? !draft.target.trim() : !url.trim() || !token)}
        disabledReason={
          busy
            ? undefined
            : ssh && !draft.target.trim()
              ? t("Enter an SSH target")
              : !ssh && !url.trim()
                ? t("Enter the Host URL")
                : !ssh && !token
                  ? t("Enter the device token")
                  : undefined
        }
        variant="primary"
        type="submit"
        form={formId}
      >
        {editing ? (busy ? t("Saving…") : editAction) : busy ? t("Connecting…") : t("Connect")}
      </Button>
    </ModalActions>
  );
  return (
    <form
      key={editing?.id ?? "new-machine"}
      id={formId}
      aria-label={title}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {!editing ? (
        <div className="flex items-center justify-between gap-3">
          {/* In a dialog the method choice already says SSH; its help ends the row, apart from the toggle. */}
          <RadioGroup
            variant="inline"
            label={t("Connection method")}
            disabled={busy}
            value={method}
            onValueChange={(next) => onMethodChange(next === "url" ? "url" : "ssh")}
            options={[
              { value: "ssh", label: t("SSH") },
              { value: "url", label: t("Host URL") },
            ]}
          />
          {ssh ? <SshHelp editing={false} /> : null}
        </div>
      ) : null}
      {editing ? (
        <div className="flex justify-end">
          <SshHelp editing />
        </div>
      ) : null}
      {ssh ? (
        <SshFields
          draft={draft}
          editing={Boolean(editing)}
          busy={busy}
          suggestion={suggestion}
          onChange={onDraftChange}
        />
      ) : (
        <>
          <TextField
            required
            disabled={busy}
            type="url"
            autoComplete="url"
            spellCheck={false}
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            label={t("Host URL")}
            fieldClassName="min-w-0 flex-1"
          />
          <PasswordField
            label={t("Device token")}
            required
            disabled={busy}
            autoComplete="off"
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
          />
        </>
      )}
      {error && (
        <Alert
          tone="danger"
          extra={errorCause ? <ErrorDetails title={errorReason} detail={errorCause} /> : undefined}
        >
          {errorReason}
        </Alert>
      )}
      {editing ? <ModalFooter>{actions}</ModalFooter> : actions}
    </form>
  );
}
