import { useEffect, useEffectEvent, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InlineMessage } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { Select } from "../../../shared/ui/Select";
import { TextField } from "../../../shared/ui/TextField";
import { useAddAndTest } from "../hooks/useAddAndTest";
import { useDecisionDialogClose } from "../hooks/useDecisionDialogClose";
import type { DecisionModelsClient, DecisionResponse } from "../model/decisionModelsClient";
import type { DecisionSource, DecisionSourceInput, SourceTestResult } from "../model/decisionTypes";
import {
  CONTRACT_ADAPTERS,
  type ContractAdapter,
  clampName,
  contractLabel,
  nameError,
} from "../model/decisionView";
import { ErrorNotice } from "./ErrorNotice";
import { pickPath } from "./pickPath";

type FolderResult = Extract<
  DecisionResponse<"decisionModels.manual.verify">,
  { kind: "installation_folder" }
>;
type FolderModel = NonNullable<FolderResult["models"]>[number];

/** Inspects an owner-selected folder without running programs; adding and testing is explicit. */
export function FolderModelDialog({
  client,
  modelPath,
  onAdd,
  onTest,
  onClose,
}: {
  client: DecisionModelsClient;
  modelPath?: string;
  onAdd: (input: DecisionSourceInput) => Promise<DecisionSource>;
  onTest: (id: string) => Promise<SourceTestResult>;
  onClose: () => void;
}) {
  const [path, setPath] = useState("");
  const [result, setResult] = useState<FolderResult | null>(null);
  const [selectedPath, setSelectedPath] = useState("");
  const [name, setName] = useState("");
  const [runtimePath, setRuntimePath] = useState("");
  const [adapter, setAdapter] = useState<ContractAdapter>("systemone");
  const [scanning, setScanning] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const flow = useAddAndTest({ onAdd: (input) => onAdd(input), onTest });
  const locked = flow.busy || flow.done;
  const close = useDecisionDialogClose(
    !flow.done && (path !== "" || name !== "" || runtimePath !== "" || adapter !== "systemone"),
    flow.busy,
    onClose,
  );
  const models: FolderModel[] =
    result?.models ??
    (result
      ? [
          {
            name:
              result.model ??
              result.modelPath
                .split(/[\\/]/)
                .pop()
                ?.replace(/\.gguf$/i, "") ??
              t("Local model"),
            modelPath: result.modelPath,
            runtimePath: result.runtimePath,
            endpoint: result.endpoint,
            model: result.model,
            projectorPath: result.projectorPath,
            verified: result.verified,
          },
        ]
      : []);
  const selected = models.find((model) => model.modelPath === selectedPath);

  const chooseModel = (model: FolderModel) => {
    setSelectedPath(model.modelPath);
    setName(model.name);
    setRuntimePath(model.runtimePath ?? "");
    setFieldError(undefined);
  };

  const changePath = (next: string) => {
    generation.current++;
    setPath(next);
    setResult(null);
    setSelectedPath("");
    setFailure(null);
    setScanning(false);
    setFieldError(undefined);
  };

  const inspect = async (
    folderPath: string,
    kind: "installation_folder" | "model_installation" = "installation_folder",
  ) => {
    const current = ++generation.current;
    setFailure(null);
    setResult(null);
    setSelectedPath("");
    if (!folderPath.trim()) {
      setFieldError(t("Choose a model folder."));
      return;
    }
    setFieldError(undefined);
    setScanning(true);
    try {
      const checked = await client.manual.verify({
        kind,
        path: folderPath.trim(),
      });
      if (current !== generation.current) return;
      if (checked.kind !== "installation_folder")
        throw new Error(t("The folder check returned an unexpected result."));
      setResult(checked);
      setPath(checked.folder);
      const first = (kind === "model_installation"
        ? checked.models?.find((model) => model.modelPath === checked.modelPath)
        : checked.models?.[0]) ?? {
        name:
          checked.model ??
          checked.modelPath
            .split(/[\\/]/)
            .pop()
            ?.replace(/\.gguf$/i, "") ??
          t("Local model"),
        ...checked,
      };
      chooseModel(first);
    } catch (error: unknown) {
      if (current === generation.current) setFailure(error);
    } finally {
      if (current === generation.current) setScanning(false);
    }
  };

  const inspectDiscovered = useEffectEvent((filePath: string) =>
    inspect(filePath, "model_installation"),
  );
  useEffect(() => {
    if (!modelPath) return;
    let active = true;
    const current = generation.current;
    void Promise.resolve()
      .then(() => {
        if (active && current === generation.current) return inspectDiscovered(modelPath);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [modelPath]);

  const browse = async () => {
    const current = generation.current;
    try {
      const folderPath = await pickPath({ title: t("Choose a model folder"), directory: true });
      if (!folderPath || current !== generation.current) return;
      changePath(folderPath);
      await inspect(folderPath);
    } catch (error: unknown) {
      if (current === generation.current) setFailure(error);
    }
  };

  const submit = () => {
    if (!selected || locked || scanning) return;
    const error = nameError(name);
    setFieldError(error ?? undefined);
    if (error || (!runtimePath.trim() && !selected.endpoint)) return;
    const input: DecisionSourceInput = {
      name: clampName(name),
      kind: "local",
      adapter,
      ...(selected.model ? { model: selected.model } : {}),
      ...(selected.endpoint ? { endpoint: selected.endpoint } : {}),
      local: {
        modelPath: selected.modelPath,
        ...(runtimePath.trim() ? { runtimePath: runtimePath.trim() } : {}),
        ...(selected.projectorPath ? { projectorPath: selected.projectorPath } : {}),
      },
    };
    void flow.submit(input, contractLabel(adapter)).catch(() => undefined);
  };

  return (
    <Modal
      title={t("Add from folder")}
      description={t(
        "Choose the folder containing your model. The app finds the model and runtime for you.",
      )}
      size="md"
      onClose={close.requestClose}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={flow.busy} onClick={close.requestClose}>
            {flow.done ? t("Close") : t("Cancel")}
          </Button>
          {!flow.done && selected ? (
            <Button
              variant="primary"
              loading={flow.busy}
              disabled={scanning || locked || (!runtimePath.trim() && !selected.endpoint)}
              onClick={submit}
            >
              {t("Add and test")}
            </Button>
          ) : null}
        </ModalActions>
      }
    >
      <div className="flex min-w-0 flex-col gap-3">
        <TextField
          label={t("Model folder")}
          value={path}
          monospace
          disabled={locked}
          error={!result ? fieldError : undefined}
          onChange={(event) => changePath(event.target.value)}
          endAdornment={
            <Button
              variant="ghost"
              size="sm"
              disabled={locked || scanning}
              onClick={() => void browse().catch(() => undefined)}
            >
              {t("Choose folder…")}
            </Button>
          }
        />
        <div className="flex justify-end">
          <Button
            variant="secondary"
            loading={scanning}
            disabled={locked || scanning}
            onClick={() => void inspect(path).catch(() => undefined)}
          >
            {t("Scan folder")}
          </Button>
        </div>
        {failure !== null ? <ErrorNotice error={failure} /> : null}
        {result?.incomplete ? (
          <InlineMessage tone="warning">
            {t(
              "The folder scan reached its search limit. Choose a smaller folder to find more models.",
            )}
          </InlineMessage>
        ) : null}
        {selected ? (
          <>
            {models.length > 1 ? (
              <Select
                label={t("Model")}
                value={selectedPath}
                disabled={locked}
                options={models.map((model) => ({ value: model.modelPath, label: model.name }))}
                onValueChange={(value) => {
                  const model = models.find((item) => item.modelPath === value);
                  if (model) chooseModel(model);
                }}
              />
            ) : (
              <InlineMessage tone="success">
                {t("Found: {p1}", { p1: selected.name })}
              </InlineMessage>
            )}
            <TextField
              label={t("Name")}
              value={name}
              disabled={locked}
              error={fieldError}
              onChange={(event) => setName(event.target.value)}
            />
            {!runtimePath.trim() && !selected.endpoint ? (
              <InlineMessage tone="warning">
                {t(
                  "Model found, but no runtime was found. Choose the runtime program under Advanced to connect it.",
                )}
              </InlineMessage>
            ) : null}
            <Disclosure
              summary={t("Advanced")}
              defaultOpen={!selected.runtimePath && !selected.endpoint}
            >
              <div className="flex min-w-0 flex-col gap-3">
                <TextField label={t("Model file")} value={selected.modelPath} readOnly monospace />
                <TextField
                  label={t("Runtime program")}
                  value={runtimePath}
                  monospace
                  disabled={locked}
                  onChange={(event) => setRuntimePath(event.target.value)}
                  endAdornment={
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={locked}
                      onClick={() => {
                        void pickPath({ title: t("Choose the runtime program") }).then(
                          (value) => {
                            if (value) setRuntimePath(value);
                          },
                          (error: unknown) => setFailure(error),
                        );
                      }}
                    >
                      {t("Choose…")}
                    </Button>
                  }
                />
                {selected.endpoint ? (
                  <TextField label={t("Address")} value={selected.endpoint} readOnly monospace />
                ) : null}
                <Select
                  label={t("Contract")}
                  value={adapter}
                  disabled={locked}
                  options={CONTRACT_ADAPTERS.map((value) => ({
                    value,
                    label: contractLabel(value),
                  }))}
                  onValueChange={(value) => setAdapter(value as ContractAdapter)}
                />
              </div>
            </Disclosure>
          </>
        ) : null}
        {flow.phase === "testing" ? (
          <InlineMessage tone="info">{t("Testing the connection…")}</InlineMessage>
        ) : null}
        {flow.failure !== null ? <ErrorNotice error={flow.failure} /> : null}
        {flow.outcome ? (
          <InlineMessage tone={flow.outcome.tone}>{flow.outcome.text}</InlineMessage>
        ) : null}
      </div>
      {close.dialog}
    </Modal>
  );
}
