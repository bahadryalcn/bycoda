import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { Heading } from "../../../shared/ui/Heading";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { ModalActions } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Surface } from "../../../shared/ui/Surface";
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
        {editing
          ? t("Changes apply to this machine. To connect a different computer, choose Add machine.")
          : t(
              "Connect a different computer with its own SSH address. Existing machines stay saved.",
            )}
      </p>
      <p>
        {t("A hostname works too, such as a Mac's Bonjour name (")}
        <Code>{"user@MacBook-Pro.local"}</Code>
        {t(") or an alias from")} <Code>{"~/.ssh/config"}</Code>
        {t(". Then the address does not need editing when the IP changes.")}
      </p>
      <p>
        {t(
          "Optional fallback for this same machine, such as its Tailscale address. If the first address cannot connect,",
        )}{" "}
        {PRODUCT_IDENTITY.displayName}
        {t(
          " automatically tries this one. Both addresses stay saved and use the same SSH port. The other address is checked against this machine's known host key.",
        )}
      </p>
      <p>
        {t(
          "Enable SSH on the target computer and make sure this computer can reach it with your SSH key or password. Sign in to the agent provider on the target computer before running agents.",
        )}
      </p>
      {editing ? (
        <p>
          {t(
            "Saving a new address closes the current connection and connects to it. If this computer has not connected to that address before, SSH asks you here whether to trust its host key. The machine's projects, sessions and history stay linked to it. If the address turns out to be another machine, the change stays saved so you can fix it; nothing is installed there.",
          )}
        </p>
      ) : (
        <>
          <p>
            {PRODUCT_IDENTITY.displayName}
            {t(
              " installs and starts its background host, then connects securely. Your SSH keys and config are used automatically. Enable SSH on the host and sign in to Codex or Claude Code there. On Windows and Mac, keep the host’s desktop account signed in and the machine awake. Locking the desktop is fine.",
            )}
          </p>
          <p>
            {t(
              "On Linux, setup installs a systemd user service and turns on lingering for your account (",
            )}
            <Code>{"loginctl enable-linger"}</Code>
            {t(
              "), so the host and your other user services keep running after you log out. The host keeps running until you stop it on that machine; removing it here only disconnects this desktop.",
            )}
          </p>
        </>
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
            tooltip={t("Fills the address. Nothing is saved or tested until you save.")}
            onClick={() => onChange({ target: suggestion })}
            variant="secondary"
            align="start"
          >
            {t("Use ")}
            {suggestion}
            {t(" instead of the IP")}
          </Button>
        )}
      </div>
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
          description={t(
            "The Host service port on this machine, separate from the SSH port. Saving reconnects to this port without changing the service. Reconnects keep this value.",
          )}
          fieldClassName="min-w-0 flex-1"
        />
      ) : null}
      <Disclosure size="sm" textSize="caption" tone="muted" summary={t("Advanced")}>
        <div className="max-w-40">
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
  saveLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const ssh = Boolean(editing) || method === "ssh";
  const title = editing ? t("Edit {p0}", { p0: editing.name }) : t("Add a new machine");
  return (
    <form
      key={editing?.id ?? "new-machine"}
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <Surface variant="outline" padding="lg" className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Heading size="item">{title}</Heading>
          {ssh ? (
            <div className="flex items-center gap-1">
              <Badge size="sm">{"SSH"}</Badge>
              <SshHelp editing={Boolean(editing)} />
            </div>
          ) : null}
        </div>
        {!editing ? (
          <div className="flex">
            <RadioGroup
              variant="inline"
              label={t("Connection method")}
              value={method}
              onValueChange={(next) => onMethodChange(next === "url" ? "url" : "ssh")}
              options={[
                { value: "ssh", label: t("SSH") },
                { value: "url", label: t("Host URL") },
              ]}
            />
          </div>
        ) : null}
        <Text as="p" tone="muted">
          {editing
            ? t("Saving reconnects this machine with the updated address.")
            : ssh
              ? t("Installs bycoda Host over SSH so you can run agents on this machine.")
              : t("Enter the host URL and a device token issued by that host.")}
        </Text>
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
        {error && <Alert tone="danger">{error}</Alert>}
        <ModalActions inline>
          <Button stableWidth type="button" disabled={busy} onClick={onCancel} variant="secondary">
            {t("Cancel")}
          </Button>
          <Button
            stableWidth
            reserveLabels={[t("Saving…"), t("Connecting…")]}
            loading={busy}
            disabled={busy || (ssh ? !draft.target.trim() : !url.trim() || !token)}
            variant="primary"
            type="submit"
          >
            {editing
              ? busy
                ? t("Saving…")
                : t(saveLabel)
              : busy
                ? t("Connecting…")
                : t("Connect")}
          </Button>
        </ModalActions>
      </Surface>
    </form>
  );
}
