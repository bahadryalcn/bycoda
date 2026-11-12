import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { NumberField } from "../../../shared/ui/NumberField";
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
import { pickPath } from "./pickPath";

export type ManualPrefill = {
  name?: string;
  modelPath?: string;
  runtimePath?: string;
  endpoint?: string;
};

type Mode = "model_file" | "endpoint";
type Errors = { name?: string; path?: string; port?: string };

const baseName = (path: string) =>
  path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.gguf$/i, "") ?? "";

/** "Add from a file or address": a model file or a running address, verified by a Host test after adding. */
export function ManualPathDialog({
  prefill,
  initialMode,
  onAdd,
  onTest,
  onClose,
}: {
  prefill?: ManualPrefill;
  initialMode?: Mode;
  onAdd: (input: DecisionSourceInput) => Promise<DecisionSource>;
  onTest: (id: string) => Promise<SourceTestResult>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>(
    initialMode ?? (prefill?.endpoint ? "endpoint" : "model_file"),
  );
  const [name, setName] = useState(prefill?.name ?? "");
  const [modelPath, setModelPath] = useState(prefill?.modelPath ?? "");
  const [runtimePath, setRuntimePath] = useState(prefill?.runtimePath ?? "");
  const [endpoint, setEndpoint] = useState(prefill?.endpoint ?? "");
  const [port, setPort] = useState("");
  const [adapter, setAdapter] = useState<ContractAdapter>("systemone");
  const [errors, setErrors] = useState<Errors>({});
  const [browseFailure, setBrowseFailure] = useState<unknown>(null);
  const flow = useAddAndTest({ onAdd: (input) => onAdd(input), onTest });
  const locked = flow.busy || flow.done;

  const build = (): DecisionSourceInput | null => {
    const next: Errors = {};
    const nameMessage = nameError(name);
    if (nameMessage) next.name = nameMessage;
    const portNumber = port.trim() ? Number(port) : undefined;
    if (mode === "endpoint") {
      const message = endpointError(endpoint);
      if (message) next.path = message;
    } else if (!modelPath.trim()) {
      next.path = t("Choose a model file.");
    }
    if (
      portNumber !== undefined &&
      (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535)
    ) {
      next.port = t("Enter a port between 1 and 65535.");
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    if (mode === "endpoint") {
      return {
        name: clampName(name),
        kind: endpointSourceKind(endpoint),
        adapter,
        endpoint: endpoint.trim(),
      };
    }
    return {
      name: clampName(name),
      kind: "local",
      adapter,
      local: {
        modelPath: modelPath.trim(),
        ...(runtimePath.trim() ? { runtimePath: runtimePath.trim() } : {}),
        ...(portNumber !== undefined ? { port: portNumber } : {}),
      },
    };
  };

  const submit = () => {
    const input = build();
    if (!input) return;
    void flow.submit(input, contractLabel(adapter)).catch(() => undefined);
  };

  const browseModel = () => {
    setBrowseFailure(null);
    pickPath({ title: t("Choose a model file"), extensions: ["gguf"] }).then(
      (picked) => {
        if (!picked) return;
        setModelPath(picked);
        if (!name.trim()) setName(baseName(picked));
      },
      (error: unknown) => setBrowseFailure(error),
    );
  };

  const browseRuntime = () => {
    setBrowseFailure(null);
    pickPath({ title: t("Choose the runtime program") }).then(
      (picked) => {
        if (picked) setRuntimePath(picked);
      },
      (error: unknown) => setBrowseFailure(error),
    );
  };

  return (
    <Modal
      title={t("Add from a file or address")}
      description={t(
        "Use a model file on this computer, or the address of a service that is already running.",
      )}
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
        <Select
          label={t("What to add")}
          value={mode}
          disabled={locked}
          options={[
            { value: "model_file", label: t("Model file") },
            { value: "endpoint", label: t("Running address") },
          ]}
          onValueChange={(value) => setMode(value as Mode)}
        />
        <TextField
          label={t("Name")}
          value={name}
          disabled={locked}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        {mode === "endpoint" ? (
          <TextField
            label={t("Address")}
            description={t("For example http://127.0.0.1:8080/v1/systemone")}
            value={endpoint}
            monospace
            disabled={locked}
            error={errors.path}
            onChange={(event) => setEndpoint(event.target.value)}
          />
        ) : (
          <>
            <TextField
              label={t("Model file")}
              value={modelPath}
              monospace
              disabled={locked}
              error={errors.path}
              onChange={(event) => setModelPath(event.target.value)}
              endAdornment={
                <Button variant="ghost" size="sm" disabled={locked} onClick={browseModel}>
                  {t("Choose…")}
                </Button>
              }
            />
            <TextField
              label={t("Runtime program (optional)")}
              description={t("Leave empty to use the runtime that came with the model.")}
              value={runtimePath}
              monospace
              disabled={locked}
              onChange={(event) => setRuntimePath(event.target.value)}
              endAdornment={
                <Button variant="ghost" size="sm" disabled={locked} onClick={browseRuntime}>
                  {t("Choose…")}
                </Button>
              }
            />
            <NumberField
              label={t("Port (optional)")}
              min={1}
              max={65535}
              step={1}
              value={port}
              disabled={locked}
              error={errors.port}
              onChange={(event) => setPort(event.target.value)}
            />
          </>
        )}
        <Select
          label={t("Contract")}
          description={t("The request format the service uses. The test checks it.")}
          value={adapter}
          disabled={locked}
          options={CONTRACT_ADAPTERS.map((value) => ({ value, label: contractLabel(value) }))}
          onValueChange={(value) => setAdapter(value as ContractAdapter)}
        />
        {flow.phase === "testing" ? (
          <InlineMessage tone="info">{t("Testing the connection…")}</InlineMessage>
        ) : null}
        {flow.failure !== null ? <ErrorNotice error={flow.failure} /> : null}
        {browseFailure !== null ? <ErrorNotice error={browseFailure} /> : null}
        {flow.outcome ? (
          <InlineMessage tone={flow.outcome.tone}>{flow.outcome.text}</InlineMessage>
        ) : null}
      </div>
    </Modal>
  );
}
