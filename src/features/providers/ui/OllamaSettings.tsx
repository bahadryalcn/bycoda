import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { refreshOpenCodeCatalog } from "../../../integrations/harness/providers/opencode/opencodeCatalog";
import { openExternal } from "../../../platform/tauri/openExternal";
import { errorText } from "../../../shared/lib/errors";
import { formatBytes } from "../../../shared/i18n/format";
import { t, useLocale } from "../../../shared/i18n";
import type { OllamaModel, OllamaStatus } from "../../../shared/model/host-contracts/ollama";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { NumberField } from "../../../shared/ui/NumberField";
import { Progress } from "../../../shared/ui/Progress";
import { TextField } from "../../../shared/ui/TextField";
import { Group, Row, SettingsFeedback } from "../../../shared/ui/settings";
import { ollamaClient } from "../model/ollamaClient";

const DOWNLOAD_URL = "https://ollama.com/download";
const PULL_POLL_MS = 1_000;
const STATUS_KEY = ["providers", "ollama", "status"] as const;

type Busy = "" | "start" | "pull" | "cancel" | "save" | "port";

const validPort = (value: number) => Number.isInteger(value) && value >= 1 && value <= 65535;

/** The loopback port Ollama listens on. Saving also moves OpenCode's Ollama models to it. */
function OllamaPortRow({
  port,
  custom,
  disabled,
  saving,
  onSave,
}: {
  port: number;
  custom: boolean;
  disabled: boolean;
  saving: boolean;
  onSave: (port: number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(String(port));
  const value = Number(draft);
  const invalid = draft.trim() !== "" && !validPort(value);
  return (
    <Row
      id="ollama-port"
      label={t("Ollama port")}
      description={t(
        "The port Ollama listens on at this computer. By default it is taken from OLLAMA_HOST, otherwise 11434.",
      )}
    >
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (validPort(value) && value !== port) void onSave(value);
        }}
      >
        <NumberField
          label={t("Ollama port")}
          hideLabel
          steppers={false}
          min={1}
          max={65535}
          fieldClassName="w-28"
          value={draft}
          disabled={disabled}
          error={invalid ? t("Enter a port from 1 to 65535.") : undefined}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button
          type="submit"
          disabled={disabled || !validPort(value) || value === port}
          disabledReason={
            disabled || invalid ? undefined : value === port ? t("The port has not changed.") : undefined
          }
          loading={saving}
        >
          {t("Save")}
        </Button>
        {custom ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => void onSave(null)}
          >
            {t("Use default")}
          </Button>
        ) : null}
      </form>
    </Row>
  );
}

const sameModels = (a: readonly string[], b: ReadonlySet<string>) =>
  a.length === b.size && a.every((model) => b.has(model));

/** One line under a model: size, parameters and whether OpenCode can use its tools. */
function modelDetails(model: OllamaModel): string {
  return [
    model.parameterSize,
    formatBytes(model.size),
    model.tools ? "" : t("No tool support: it can chat but cannot edit files or run commands"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Settings > Models > OpenCode: run local Ollama models through OpenCode. It finds or starts
 * Ollama, downloads a model and lists the chosen models in OpenCode's user config, after which
 * they appear in OpenCode's model list. Installing Ollama or OpenCode stays with the owner.
 */
export function OllamaSettings({ opencodeAvailable }: { opencodeAvailable: boolean }) {
  useLocale();
  const queryClient = useQueryClient();
  // The Host downloads in the background, so the status is polled only while a download runs.
  const query = useQuery({
    queryKey: STATUS_KEY,
    queryFn: ollamaClient.status,
    retry: false,
    staleTime: 0,
    refetchInterval: (state) =>
      state.state.data?.pull?.state === "running" ? PULL_POLL_MS : false,
  });
  const status = query.data;
  const loadError = query.error ? errorText(query.error) : "";
  const load = () => void query.refetch();
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState<Busy>("");
  /** The owner's unsaved choice; undefined follows the models saved in the OpenCode config. */
  const [draft, setDraft] = useState<Set<string>>();
  const [modelName, setModelName] = useState("");
  const selected = draft ?? new Set(status?.opencode.models ?? []);
  const pulling = status?.pull?.state === "running";

  const run = async (kind: Busy, action: () => Promise<OllamaStatus>) => {
    if (busy) return false;
    setBusy(kind);
    setError("");
    setSaved(false);
    try {
      queryClient.setQueryData(STATUS_KEY, await action());
      return true;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    } finally {
      setBusy("");
    }
  };

  const toggle = (name: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(name);
    else next.delete(name);
    setDraft(next);
    setSaved(false);
  };

  const save = async () => {
    if (!(await run("save", () => ollamaClient.saveOpencode([...selected])))) return;
    setDraft(undefined);
    setSaved(true);
    // OpenCode reloads its config by itself; the app's cached model list is read again.
    void refreshOpenCodeCatalog().catch((reason: unknown) => setError(errorText(reason)));
  };

  const download = () => {
    const name = modelName.trim();
    if (!name) return;
    void run("pull", () => ollamaClient.pull(name)).then((ok) => {
      if (ok) setModelName("");
    });
  };

  const feedback = (() => {
    if (loadError)
      return (
        <SettingsFeedback state="error" action={{ label: t("Retry"), onClick: () => void load() }}>
          {loadError}
        </SettingsFeedback>
      );
    if (error) return <SettingsFeedback state="error">{error}</SettingsFeedback>;
    if (saved)
      return (
        <SettingsFeedback state="success">
          {t("Saved. The chosen models appear in OpenCode's model list.")}
        </SettingsFeedback>
      );
    return undefined;
  })();

  const body = (() => {
    if (!status)
      return loadError ? null : (
        <SettingsFeedback state="loading">{t("Checking Ollama…")}</SettingsFeedback>
      );
    if (status.runtime === "missing")
      return (
        <SettingsFeedback
          state="warning"
          action={{ label: t("Download Ollama"), onClick: () => void openExternal(DOWNLOAD_URL) }}
          secondaryAction={{ label: t("Check again"), onClick: () => void load() }}
        >
          {t("Ollama is not installed on this computer. Install it, then check again.")}
        </SettingsFeedback>
      );
    if (status.runtime === "stopped")
      return (
        <SettingsFeedback
          state="warning"
          action={{
            label: t("Start Ollama"),
            pending: busy === "start",
            onClick: () => void run("start", ollamaClient.start),
          }}
        >
          {t("Ollama is installed but not running.")}
        </SettingsFeedback>
      );
    const chatModels = status.models.filter((model) => model.chat);
    // Models already in the config but no longer in Ollama stay listed, so they can be removed.
    const missing = status.opencode.models.filter(
      (name) => !chatModels.some((model) => model.name === name),
    );
    const configBlocked = status.opencode.config !== "ready";
    const pull = status.pull;
    const notice = !opencodeAvailable ? (
      <SettingsFeedback state="warning">
        {t("Install OpenCode above to use these models.")}
      </SettingsFeedback>
    ) : configBlocked ? (
      <SettingsFeedback state="warning">
        {status.opencode.config === "comments"
          ? t("The OpenCode config file has comments. Add the models to it by hand to keep them.")
          : t("The OpenCode config file could not be read. Fix it, then check again.")}
      </SettingsFeedback>
    ) : undefined;
    return (
      <>
        <Row label={t("Ollama models")} stacked feedback={notice}>
          <div className="flex min-w-0 flex-col gap-2">
            {chatModels.length || missing.length ? (
              <div
                className="flex min-w-0 flex-col gap-1"
                role="group"
                aria-label={t("Ollama models")}
              >
                {chatModels.map((model) => (
                  <Checkbox
                    key={model.name}
                    appearance="row"
                    checked={selected.has(model.name)}
                    disabled={!!busy || configBlocked}
                    label={model.name}
                    description={modelDetails(model)}
                    onChange={(event) => toggle(model.name, event.target.checked)}
                  />
                ))}
                {missing.map((name) => (
                  <Checkbox
                    key={name}
                    appearance="row"
                    checked={selected.has(name)}
                    disabled={!!busy || configBlocked}
                    label={name}
                    description={t("Not downloaded in Ollama")}
                    onChange={(event) => toggle(name, event.target.checked)}
                  />
                ))}
              </div>
            ) : (
              <SettingsFeedback state="empty">
                {t("No chat models in Ollama yet. Download one below.")}
              </SettingsFeedback>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                disabled={
                  !opencodeAvailable ||
                  configBlocked ||
                  (!!busy && busy !== "save") ||
                  sameModels(status.opencode.models, selected)
                }
                loading={busy === "save"}
                onClick={() => void save()}
              >
                {t("Save to OpenCode")}
              </Button>
            </div>
          </div>
        </Row>
        <Row
          label={t("Download a model")}
          description={t(
            "Model names are listed in the Ollama library. Models with tool support work best with OpenCode.",
          )}
          stacked
          feedback={pull ? <PullState pull={pull} /> : undefined}
        >
          <form
            className="flex min-w-0 flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              download();
            }}
          >
            <TextField
              label={t("Download a model")}
              hideLabel
              fieldClassName="min-w-0 flex-1"
              placeholder="qwen3:8b"
              value={modelName}
              spellCheck={false}
              autoComplete="off"
              maxLength={200}
              disabled={pulling || !!busy}
              onChange={(event) => setModelName(event.target.value)}
            />
            {pulling ? (
              <Button
                type="button"
                loading={busy === "cancel"}
                onClick={() => void run("cancel", ollamaClient.cancelPull)}
              >
                {t("Cancel")}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={!modelName.trim() || !!busy}
                loading={busy === "pull"}
              >
                {t("Download")}
              </Button>
            )}
            <Button
              type="button"
              variant="link"
              onClick={() => void openExternal("https://ollama.com/search?c=tools")}
            >
              {t("Browse models with tools")}
            </Button>
          </form>
        </Row>
      </>
    );
  })();

  return (
    <Group
      id="ollama-models"
      title={t("Local models (Ollama)")}
      description={t("Run Ollama models on this computer through OpenCode.")}
      action={
        // Missing and stopped states carry their own Check again / Start action.
        status?.runtime === "running" ? (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void load()}>
            {status.version ? t("Ollama {p0}", { p0: status.version }) : t("Check again")}
          </Button>
        ) : undefined
      }
      feedback={feedback}
    >
      {body}
      {status ? (
        // Keyed by the saved port, so a saved or reset value restarts the draft.
        <OllamaPortRow
          key={status.port}
          port={status.port}
          custom={status.portCustom}
          disabled={!!busy || pulling}
          saving={busy === "port"}
          onSave={(port) => run("port", () => ollamaClient.setPort(port))}
        />
      ) : null}
    </Group>
  );
}

function PullState({ pull }: { pull: NonNullable<OllamaStatus["pull"]> }) {
  if (pull.state === "running")
    return pull.total > 0 ? (
      <Progress
        value={Math.min(pull.completed, pull.total)}
        max={pull.total}
        label={t("Downloading {p0}: {p1} of {p2}", {
          p0: pull.model,
          p1: formatBytes(pull.completed),
          p2: formatBytes(pull.total),
        })}
      />
    ) : (
      <Progress label={t("Downloading {p0}…", { p0: pull.model })} />
    );
  if (pull.state === "done")
    return (
      <SettingsFeedback state="success">
        {t("{p0} is downloaded. Select it above and save.", { p0: pull.model })}
      </SettingsFeedback>
    );
  if (pull.state === "cancelled")
    return (
      <SettingsFeedback state="warning">
        {t("Download of {p0} was cancelled.", { p0: pull.model })}
      </SettingsFeedback>
    );
  return (
    <SettingsFeedback state="error">
      {t("Could not download {p0}: {p1}", { p0: pull.model, p1: pull.error ?? t("Unknown error") })}
    </SettingsFeedback>
  );
}
