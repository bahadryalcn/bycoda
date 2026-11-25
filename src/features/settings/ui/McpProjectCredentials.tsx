import { useRef, useState, type FormEvent } from "react";
import { t } from "../../../shared/i18n";
import { confirmInApp } from "../../../shared/model/appConfirm";
import { Button } from "../../../shared/ui/Button";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { TextField } from "../../../shared/ui/TextField";
import { Plus, X } from "../../../shared/ui/icons";
import type { McpHub } from "../hooks/useMcpHub";

type CredentialField = { id: number; name: string; value: string };

export function McpProjectCredentials({
  name,
  displayName = name,
  machineName,
  projectName,
  kind,
  configured,
  request,
  onClose,
}: {
  name: string;
  displayName?: string;
  machineName: string;
  projectName?: string;
  kind: "http" | "stdio";
  configured: boolean;
  request: NonNullable<McpHub["projectCredentials"]>;
  onClose: () => void;
}) {
  const http = kind === "http";
  const nextId = useRef(1);
  const operating = useRef(false);
  const [fields, setFields] = useState<CredentialField[]>([
    { id: 0, name: http ? "Authorization" : "", value: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const [errorTitle, setErrorTitle] = useState("");
  const dirty = fields.some(
    (field) => field.value || field.name !== (field.id === 0 && http ? "Authorization" : ""),
  );

  async function close() {
    if (operating.current) return;
    if (
      !dirty ||
      (await confirmInApp({
        title: t("Discard unsaved credentials?"),
        confirmLabel: t("Discard"),
        message: t("The values you entered will be cleared."),
        tone: "danger",
      }))
    )
      onClose();
  }

  async function change(values?: Record<string, string>) {
    if (operating.current) return;
    operating.current = true;
    setBusy(true);
    setErrorTitle("");
    try {
      await request(values ? "set" : "clear", name, values);
      onClose();
    } catch {
      // Credential RPC failures can include submitted values. Keep this feedback safe to disclose.
      setErrorTitle(
        projectName
          ? t("Could not update project credentials. Check the Host connection and try again.")
          : values
            ? t("Could not save credentials.")
            : t("Could not remove credentials."),
      );
    } finally {
      operating.current = false;
      setBusy(false);
    }
  }

  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const names = fields.map((field) => field.name.trim());
    const valid = http ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/;
    if (
      names.some((key) => !valid.test(key)) ||
      new Set(http ? names.map((key) => key.toLowerCase()) : names).size !== names.length
    ) {
      setErrorTitle(t("Use a valid, unique name for each credential."));
      return;
    }
    void change(Object.fromEntries(fields.map((field, index) => [names[index], field.value])));
  };

  return (
    <Modal
      title={
        projectName
          ? configured
            ? t("Replace project credentials")
            : t("Set project credentials")
          : configured
            ? t("Manage credentials")
            : t("Set credentials")
      }
      description={t("{p0} · {p1} · {p2}", {
        p0: displayName,
        p1: projectName ?? t("Global"),
        p2: machineName,
      })}
      onClose={() => void close()}
      fitViewport
    >
      <form onSubmit={save} className="grid gap-4">
        {configured && projectName ? (
          <p>{t("Saving replaces all previously saved values for this server in this project.")}</p>
        ) : null}
        {fields.map((field) => (
          <div key={field.id} className="flex flex-wrap items-end gap-2">
            <div className="min-w-36 flex-1">
              <TextField
                label={http ? t("Header name") : t("Environment variable")}
                value={field.name}
                required
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) =>
                  setFields(
                    fields.map((item) =>
                      item.id === field.id ? { ...item, name: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            <div className="min-w-36 flex-1">
              <PasswordField
                label={t("Secret value")}
                value={field.value}
                placeholder={
                  http && field.name.toLowerCase() === "authorization" ? "Bearer …" : undefined
                }
                required
                disabled={busy}
                autoComplete="off"
                onChange={(event) =>
                  setFields(
                    fields.map((item) =>
                      item.id === field.id ? { ...item, value: event.target.value } : item,
                    ),
                  )
                }
              />
            </div>
            {fields.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                iconOnly
                label={t("Remove field")}
                disabled={busy}
                onClick={() => setFields(fields.filter((item) => item.id !== field.id))}
              >
                <X className="icon-sm" />
              </Button>
            ) : null}
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy || fields.length >= 20}
            disabledReason={
              fields.length >= 20 ? t("You can add up to 20 credentials.") : undefined
            }
            onClick={() => {
              const id = nextId.current++;
              setFields([...fields, { id, name: "", value: "" }]);
            }}
          >
            <Plus className="icon-sm" />
            {http ? t("Add header") : t("Add variable")}
          </Button>
        </div>
        {errorTitle ? <InlineError>{errorTitle}</InlineError> : null}
        <ModalActions>
          {configured ? (
            <Button
              type="button"
              variant="ghost"
              tone="danger"
              disabled={busy}
              onClick={() => {
                void confirmInApp({
                  title: projectName ? t("Remove project credentials?") : t("Remove credentials"),
                  message: t("New sessions will use the server’s default authentication."),
                  confirmLabel: t("Remove credentials"),
                  tone: "danger",
                })
                  .then((confirmed) => (confirmed ? change() : undefined))
                  .catch(() => {
                    setErrorTitle(
                      t(
                        "Could not update project credentials. Check the Host connection and try again.",
                      ),
                    );
                  });
              }}
            >
              {t("Remove credentials")}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" disabled={busy} onClick={() => void close()}>
            {t("Cancel")}
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={busy}>
            {t("Save credentials")}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
