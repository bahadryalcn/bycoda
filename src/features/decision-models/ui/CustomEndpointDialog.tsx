import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { useAddAndTest } from "../hooks/useAddAndTest";
import type { DecisionSource, DecisionSourceInput, SourceTestResult } from "../model/decisionTypes";
import {
  CONTRACT_ADAPTERS,
  type ContractAdapter,
  clampName,
  contractLabel,
  endpointError,
  endpointSourceKind,
  nameError,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

export type CustomPrefill = { name?: string; endpoint?: string };

/** "Custom endpoint": any address that answers a decision contract, with an optional key. */
export function CustomEndpointDialog({
  prefill,
  onAdd,
  onTest,
  onClose,
}: {
  prefill?: CustomPrefill;
  onAdd: (input: DecisionSourceInput, apiKey?: string) => Promise<DecisionSource>;
  onTest: (id: string) => Promise<SourceTestResult>;
  onClose: () => void;
}) {
  const [name, setName] = useState(prefill?.name ?? "");
  const [endpoint, setEndpoint] = useState(prefill?.endpoint ?? "");
  const [model, setModel] = useState("");
  const [adapter, setAdapter] = useState<ContractAdapter>("systemone");
  const [apiKey, setApiKey] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [errors, setErrors] = useState<{ name?: string; endpoint?: string }>({});
  const flow = useAddAndTest({ onAdd, onTest });
  const locked = flow.busy || flow.done;

  const submit = () => {
    const nextErrors: { name?: string; endpoint?: string } = {};
    const nameMessage = nameError(name);
    if (nameMessage) nextErrors.name = nameMessage;
    const endpointMessage = endpointError(endpoint);
    if (endpointMessage) nextErrors.endpoint = endpointMessage;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const key = apiKey.trim();
    // The key leaves component state before the request, so a failed attempt does not keep it.
    setApiKey("");
    const input: DecisionSourceInput = {
      name: clampName(name),
      kind: endpointSourceKind(endpoint),
      adapter,
      endpoint: endpoint.trim(),
      ...(model.trim() ? { model: model.trim() } : {}),
      // The Host checks the header name; an empty field keeps Authorization: Bearer.
      ...(authHeader.trim() ? { authHeader: authHeader.trim() } : {}),
    };
    void flow.submit(input, contractLabel(adapter), key || undefined).catch(() => undefined);
  };

  return (
    <Modal
      title={t("Custom endpoint")}
      description={t("Connect a service at an address you choose.")}
      size="md"
      onClose={onClose}
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {flow.done ? t("Close") : t("Cancel")}
          </Button>
          {flow.done ? null : (
            <Button variant="primary" loading={flow.busy} disabled={flow.busy} onClick={submit}>
              {t("Add and test")}
            </Button>
          )}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <TextField
          label={t("Name")}
          value={name}
          disabled={locked}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t("Address")}
          value={endpoint}
          monospace
          disabled={locked}
          error={errors.endpoint}
          onChange={(event) => setEndpoint(event.target.value)}
        />
        <Select
          label={t("Contract")}
          description={t("The request format the service uses. The test checks it.")}
          value={adapter}
          disabled={locked}
          options={CONTRACT_ADAPTERS.map((value) => ({ value, label: contractLabel(value) }))}
          onValueChange={(value) => setAdapter(value as ContractAdapter)}
        />
        <TextField
          label={t("Model (optional)")}
          value={model}
          monospace
          disabled={locked}
          onChange={(event) => setModel(event.target.value)}
        />
        <PasswordField
          label={t("API key (optional)")}
          description={t("Saved on this computer. It is never shown again.")}
          value={apiKey}
          autoComplete="off"
          disabled={locked}
          onChange={(event) => setApiKey(event.target.value)}
        />
        <TextField
          label={t("Key header name (optional)")}
          description={t("Leave empty to send the key as Authorization: Bearer.")}
          value={authHeader}
          monospace
          disabled={locked}
          onChange={(event) => setAuthHeader(event.target.value)}
        />
        <InlineMessage tone="neutral">{t("Field mapping is not available yet.")}</InlineMessage>
        {flow.phase === "testing" ? (
          <InlineMessage tone="info">{t("Testing the connection…")}</InlineMessage>
        ) : null}
        {flow.failure !== null ? <ErrorNotice error={flow.failure} /> : null}
        {flow.outcome ? (
          <InlineMessage tone={flow.outcome.tone}>{flow.outcome.text}</InlineMessage>
        ) : null}
      </div>
    </Modal>
  );
}
