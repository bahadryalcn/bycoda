import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { TextField } from "../../../shared/ui/TextField";
import type { DecisionSource, DecisionSourceInput } from "../model/decisionTypes";
import { clampName, endpointError, nameError } from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

/** Edit name, address and model. A key is replaced only when typed; the saved key is never shown. */
export function EditSourceDialog({
  source,
  onSave,
  onClose,
}: {
  source: DecisionSource;
  onSave: (patch: Partial<DecisionSourceInput>, apiKey?: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const hasEndpoint = source.endpoint !== undefined;
  const hasKey = source.kind !== "local";
  const [name, setName] = useState(source.name);
  const [endpoint, setEndpoint] = useState(source.endpoint ?? "");
  const [model, setModel] = useState(source.model ?? "");
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<{ name?: string; endpoint?: string }>({});
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const save = () => {
    const next: { name?: string; endpoint?: string } = {};
    const nameMessage = nameError(name);
    if (nameMessage) next.name = nameMessage;
    if (hasEndpoint) {
      const message = endpointError(endpoint);
      if (message) next.endpoint = message;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    const patch: Partial<DecisionSourceInput> = { name: clampName(name) };
    if (hasEndpoint) patch.endpoint = endpoint.trim();
    if (model.trim()) patch.model = model.trim();
    const key = apiKey.trim();
    // The typed key leaves component state before the request.
    setApiKey("");
    setSaving(true);
    setFailure(null);
    onSave(patch, key || undefined).then(
      () => {
        setSaving(false);
        onClose();
      },
      (error: unknown) => {
        setSaving(false);
        setFailure(error);
      },
    );
  };

  return (
    <Modal
      title={t("Edit source")}
      size="md"
      onClose={onClose}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button variant="primary" loading={saving} disabled={saving} onClick={save}>
            {t("Save")}
          </Button>
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <TextField
          label={t("Name")}
          value={name}
          disabled={saving}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        {hasEndpoint ? (
          <TextField
            label={t("Address")}
            value={endpoint}
            monospace
            disabled={saving}
            error={errors.endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        ) : null}
        <TextField
          label={t("Model (optional)")}
          value={model}
          monospace
          disabled={saving}
          onChange={(event) => setModel(event.target.value)}
        />
        {hasKey ? (
          <PasswordField
            label={t("Replace API key")}
            description={t("Leave empty to keep the saved key.")}
            value={apiKey}
            autoComplete="off"
            disabled={saving}
            onChange={(event) => setApiKey(event.target.value)}
          />
        ) : null}
        {!hasEndpoint && !hasKey ? (
          <InlineMessage tone="neutral">{t("Only the name can be changed here.")}</InlineMessage>
        ) : null}
        {failure !== null ? <ErrorNotice error={failure} /> : null}
      </div>
    </Modal>
  );
}
