import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { PasswordField } from "../../../shared/ui/PasswordField";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { useAddAndTest } from "../hooks/useAddAndTest";
import type {
  DecisionCatalogEntry,
  DecisionSource,
  DecisionSourceInput,
  SourceTestResult,
} from "../model/decisionTypes";
import { catalogLabel, contractLabel } from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";

/**
 * "API provider": the catalog supplies the address and contract; the user adds only a key. Gateway model
 * lists are not in the contract yet, so the model is typed by hand.
 */
export function ApiProviderDialog({
  catalog,
  catalogError,
  preselectId,
  onAdd,
  onTest,
  onClose,
}: {
  catalog: DecisionCatalogEntry[] | null;
  catalogError: unknown;
  preselectId?: string;
  onAdd: (input: DecisionSourceInput, apiKey?: string) => Promise<DecisionSource>;
  onTest: (id: string) => Promise<SourceTestResult>;
  onClose: () => void;
}) {
  const entries = catalog ?? [];
  const [selectedId, setSelectedId] = useState(
    () => entries.find((entry) => entry.id === preselectId)?.id ?? entries[0]?.id ?? "",
  );
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [errors, setErrors] = useState<{ key?: string; provider?: string }>({});
  const [linkFailure, setLinkFailure] = useState<unknown>(null);
  const flow = useAddAndTest({ onAdd, onTest });
  const locked = flow.busy || flow.done;
  const entry = entries.find((item) => item.id === selectedId);

  const submit = () => {
    if (!entry) {
      setErrors({ provider: t("Choose a provider.") });
      return;
    }
    const key = apiKey.trim();
    if (!key) {
      setErrors({ key: t("Enter the API key.") });
      return;
    }
    setErrors({});
    // The key leaves component state before the request, so a failed attempt does not keep it.
    setApiKey("");
    const input: DecisionSourceInput = {
      name: entry.name,
      kind: entry.kind,
      adapter: entry.adapter,
      ...(entry.endpoint ? { endpoint: entry.endpoint } : {}),
      ...(model.trim() ? { model: model.trim() } : {}),
    };
    void flow.submit(input, contractLabel(entry.adapter), key).catch(() => undefined);
  };

  const openDocs = (url: string) => {
    setLinkFailure(null);
    openExternal(url).catch((error: unknown) => setLinkFailure(error));
  };

  return (
    <Modal
      title={t("API provider")}
      description={t(
        "Add a provider with your own key. The address and contract come from the catalog.",
      )}
      size="md"
      onClose={onClose}
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {flow.done ? t("Close") : t("Cancel")}
          </Button>
          {flow.done || catalog === null ? null : (
            <Button
              variant="primary"
              loading={flow.busy}
              disabled={flow.busy || !entry}
              onClick={submit}
            >
              {t("Add and test")}
            </Button>
          )}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        {catalogError !== null ? <ErrorNotice error={catalogError} /> : null}
        {catalog === null && catalogError === null ? (
          <p className="text-ui-caption text-(--ui-text-secondary)">{t("Loading providers…")}</p>
        ) : null}
        {catalog !== null && entries.length === 0 ? (
          <InlineMessage tone="neutral">{t("No providers are listed yet.")}</InlineMessage>
        ) : null}
        {entries.length > 0 ? (
          <Select
            label={t("Provider")}
            value={selectedId}
            disabled={locked}
            error={errors.provider}
            options={entries.map((item) => ({ value: item.id, label: catalogLabel(item) }))}
            onValueChange={setSelectedId}
          />
        ) : null}
        {entry ? (
          <div className="text-ui-caption flex min-w-0 flex-col gap-1 text-(--ui-text-secondary)">
            <span className="truncate">{contractLabel(entry.adapter)}</span>
            {entry.endpoint ? <span className="truncate font-mono">{entry.endpoint}</span> : null}
            {entry.docsUrl ? (
              <div>
                <Button variant="ghost" size="sm" onClick={() => openDocs(entry.docsUrl ?? "")}>
                  {t("Provider documentation")}
                </Button>
              </div>
            ) : null}
            {entry.verified ? null : (
              <InlineMessage tone="warning">
                {t("Details for this provider are not verified. Measure accuracy after adding.")}
              </InlineMessage>
            )}
          </div>
        ) : null}
        <TextField
          label={t("Model (optional)")}
          description={
            entry?.kind === "gateway"
              ? t("The model list for this gateway is not available yet. Type the model name.")
              : t("Type the model name, if the provider needs one.")
          }
          value={model}
          monospace
          disabled={locked}
          onChange={(event) => setModel(event.target.value)}
        />
        <PasswordField
          label={t("API key")}
          description={t("Saved on this computer. It is never shown again.")}
          value={apiKey}
          autoComplete="off"
          disabled={locked}
          error={errors.key}
          onChange={(event) => setApiKey(event.target.value)}
        />
        {flow.phase === "testing" ? (
          <InlineMessage tone="info">{t("Testing the connection…")}</InlineMessage>
        ) : null}
        {flow.failure !== null ? <ErrorNotice error={flow.failure} /> : null}
        {linkFailure !== null ? <ErrorNotice error={linkFailure} /> : null}
        {flow.outcome ? (
          <InlineMessage tone={flow.outcome.tone}>{flow.outcome.text}</InlineMessage>
        ) : null}
      </div>
    </Modal>
  );
}
