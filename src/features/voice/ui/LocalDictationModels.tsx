import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import {
  LocalDictationModelRow,
  ModelCancelButton,
  type ModelCancelState,
} from "./LocalDictationModelRow";
import { useContext, useEffect, useRef, useState } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { RevealedSetting, Select, SettingsFeedback } from "../../../shared/ui/settings";
import { SearchInput } from "../../../shared/ui/SearchInput";
import {
  localDictationModels,
  rankLocalModels,
  supportsDictationLanguage,
  type LocalDictationModel,
  type LocalModelJob,
} from "../model/localDictationModels";
import { knownLocalModelMessage } from "../model/voiceEngineMessages";
import { voiceRuntimeSettings, type VoiceSettings } from "../model/voiceSettings";
import { DICTATION_LANGUAGES } from "../model/dictationModels";
import { useDetectedDictationLanguage } from "../model/dictationActivity";

const STATUS_POLL_MS = 1000;
const MAX_STATUS_RETRIES = 5;
const MAX_STATUS_RETRY_DELAY_MS = 16_000;

/** Browse and manage transcription models owned by the local Host. */
export function LocalDictationModels({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
  const [models, setModels] = useState<LocalDictationModel[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [manageOpen, setManageOpen] = useState(false);
  const [revealSeen, setRevealSeen] = useState<string | null>(null);
  const revealed = useContext(RevealedSetting);
  const { formatBytes } = useFormat();
  const locale = useLocale();
  const detected = useDetectedDictationLanguage();
  const [job, setJob] = useState<LocalModelJob>({ state: "idle" });
  const [actionNotice, setActionNotice] = useState("");
  /** Raw host text behind a failed model action, shown only in Details. */
  const [errorDetail, setErrorDetail] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<{
    action: NonNullable<LocalModelJob["action"]>;
    id: LocalDictationModel["id"];
  } | null>(null);
  const [cancelState, setCancelState] = useState<ModelCancelState>(null);
  const { confirm, dialog } = useConfirm();
  const starting = useRef(false);
  // oxlint-disable-next-line bycoda/effect-names-its-sync -- owns polling timer for the running host job and clears it on unmount
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Last observed state is "working": keep polling it through transient failures.
    let working = false;
    let failures = 0;
    async function refresh() {
      try {
        const [next, state] = await Promise.all([
          localDictationModels.list(),
          localDictationModels.status(),
        ]);
        if (!active) return;
        if (failures > 0) setActionNotice("");
        failures = 0;
        setModels(next);
        setJob(state);
        setLoading(false);
        if (state.state !== "working") setCancelState(null);
        if (state.state === "ready" && state.action === "delete") {
          const deleted = next.find((model) => model.id === state.id);
          if (deleted && !deleted.installed && settings.dictationLocalModelPath === deleted.path)
            change({ dictationLocalModelPath: "" });
        }
        working = state.state === "working";
        if (working) timer = setTimeout(() => void refresh(), STATUS_POLL_MS);
      } catch {
        if (!active) return;
        setLoading(false);
        setActionNotice(t("Could not load local models."));
        // Bounded retries with backoff; the last known job stays visible. "Try again" re-arms polling after the limit.
        if (working && failures < MAX_STATUS_RETRIES) {
          failures += 1;
          timer = setTimeout(
            () => void refresh(),
            Math.min(STATUS_POLL_MS * 2 ** failures, MAX_STATUS_RETRY_DELAY_MS),
          );
        }
      }
    }
    void refresh();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [change, revision, settings.dictationLocalModelPath]);
  async function action(action: NonNullable<LocalModelJob["action"]>, model: LocalDictationModel) {
    if (starting.current) return;
    starting.current = true;
    setPending({ action, id: model.id });
    setActionNotice("");
    setErrorDetail("");
    setCancelState(null);
    try {
      const state = await localDictationModels.start(
        action,
        model.id,
        voiceRuntimeSettings({ ...settings, natural: false }),
      );
      setJob(state);
      setActionNotice("");
      setRevision((value) => value + 1);
    } catch (cause) {
      setActionNotice(t("Model action failed."));
      setErrorDetail(cause instanceof Error ? cause.message : "");
    } finally {
      starting.current = false;
      setPending(null);
    }
  }
  const busy = pending !== null || job.state === "working";
  const operation = pending ?? job;
  const selectedModel = models.find((model) => model.path === settings.dictationLocalModelPath);
  const preferred =
    settings.dictationLanguage === "auto"
      ? detected || locale.split("-")[0]
      : settings.dictationLanguage;
  const preferredLabel = DICTATION_LANGUAGES.find(([id]) => id === preferred)?.[1];
  const needle = query.trim().toLowerCase();
  const visibleModels = rankLocalModels(models, preferred).filter(
    (model) =>
      (filter !== "installed" || model.installed) && model.label.toLowerCase().includes(needle),
  );
  const operationLabel =
    operation.action === "download"
      ? t("Downloading…")
      : operation.action === "delete"
        ? t("Deleting…")
        : t("Testing…");
  const hasBytes = job.state === "working" && job.bytesDone !== undefined && !!job.bytesTotal;
  const progressText = hasBytes
    ? `${operationLabel} ${formatBytes(job.bytesDone ?? 0)} / ${formatBytes(job.bytesTotal ?? 0)}`
    : operationLabel;
  const progressValue = hasBytes ? (job.bytesDone ?? 0) / (job.bytesTotal ?? 1) : undefined;
  // A search reveal of a model row opens the manager once per target; the owner can close it afterwards.
  const revealsModel =
    !!revealed && revealed.startsWith("dictation-local-") && revealed !== "dictation-local-models";
  if (revealsModel && revealSeen !== revealed) {
    setRevealSeen(revealed);
    setManageOpen(true);
  }
  async function requestDelete(model: LocalDictationModel) {
    if (
      await confirm({
        title: t("Delete {p0}?", { p0: model.label }),
        message: t("Removes this model's local files. You can download it again."),
        confirmLabel: t("Delete"),
        danger: true,
      })
    )
      await action("delete", model);
  }
  async function cancel() {
    setCancelState("requesting");
    setActionNotice("");
    try {
      const next = await localDictationModels.cancel();
      setJob(next);
      setCancelState(next.state === "working" ? "requested" : null);
      setRevision((value) => value + 1);
    } catch {
      setCancelState(null);
      setActionNotice(t("Could not request cancellation. Try again."));
    }
  }
  const hostText = errorDetail || job.detail || "";
  const knownText = knownLocalModelMessage(hostText);
  const headline = knownText || actionNotice || t("Model action failed.");
  const canCancel = job.state === "working" && !pending;
  // The running model's own row owns Cancel; when a filter hides that row, the picker keeps it reachable.
  const cancelInPicker = canCancel && !visibleModels.some((model) => model.id === job.id);
  return (
    <>
      {dialog}
      <Row
        id="dictation-local-models"
        label={t("Model")}
        feedback={
          actionNotice || job.state === "error" ? (
            <SettingsFeedback
              state="error"
              action={
                actionNotice
                  ? {
                      label: t("Try again"),
                      onClick: () => {
                        setLoading(true);
                        setActionNotice("");
                        setRevision((value) => value + 1);
                      },
                    }
                  : undefined
              }
              extra={
                hostText && !knownText ? (
                  <ErrorDetails title={headline} detail={hostText} />
                ) : undefined
              }
            >
              {headline}
            </SettingsFeedback>
          ) : job.state === "ready" && job.action === "test" ? (
            <SettingsFeedback state="success">
              {t("Model loaded successfully on CPU.")}
            </SettingsFeedback>
          ) : undefined
        }
      >
        <div className="flex items-center gap-2">
          <Select
            hideLabel
            label={t("Model")}
            value={selectedModel?.installed ? selectedModel.path : ""}
            disabled={busy}
            options={[
              { value: "", label: t("Automatic") },
              ...models
                .filter((model) => model.installed)
                .map((model) => ({
                  value: model.path,
                  label: model.label,
                  disabled: model.available === false,
                  disabledReason:
                    model.available === false ? t("Unavailable on this platform") : undefined,
                })),
            ]}
            onChange={(path) => change({ dictationLocalModelPath: path })}
          />
          {cancelInPicker ? (
            <ModelCancelButton state={cancelState} onCancel={() => void cancel()} />
          ) : null}
        </div>
      </Row>
      {loading ? <LoadingText>{t("Loading models…")}</LoadingText> : null}
      {!loading && !actionNotice && !models.length ? (
        <EmptyState size="inline" description={t("No local transcription models found.")} />
      ) : null}
      {models.length > 0 ? (
        <Disclosure
          variant="row"
          textSize="secondary"
          summary={t("Manage models")}
          count={models.length}
          open={manageOpen}
          onOpenChange={setManageOpen}
        >
          <Row label={t("Search models")} controlWidth="wide">
            <div className="flex min-w-0 items-center gap-2">
              <SearchInput
                containerClassName="min-w-0 flex-1"
                aria-label={t("Search models")}
                placeholder={t("Model name")}
                appearance="field"
                fieldSize="sm"
                textSize="secondary"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <Select
                hideLabel
                label={t("Model availability")}
                value={filter}
                options={[
                  { value: "all", label: t("All models") },
                  { value: "installed", label: t("Installed") },
                ]}
                onChange={setFilter}
              />
            </div>
          </Row>
          {visibleModels.length === 0 ? (
            <EmptyState
              size="inline"
              context="list"
              kind="filtered"
              description={t("No matching models.")}
              onReset={() => {
                setQuery("");
                setFilter("all");
              }}
            />
          ) : null}
          {visibleModels.map((model) => {
            const pendingHere = pending?.id === model.id ? pending.action : null;
            return (
              <LocalDictationModelRow
                key={model.id}
                model={model}
                selected={settings.dictationLocalModelPath === model.path}
                busy={busy}
                working={job.state === "working" && !pending && job.id === model.id}
                pendingAction={pendingHere}
                progressText={progressText}
                progressValue={progressValue}
                meta={[
                  model.available === false ? t("Unavailable on this platform") : "",
                  model.sizeBytes ? formatBytes(model.sizeBytes) : "",
                  model.format === "faster-whisper"
                    ? "Faster Whisper"
                    : model.format === "gguf"
                      ? "GGUF"
                      : "",
                  preferredLabel && model.languages && supportsDictationLanguage(model, preferred)
                    ? preferredLabel
                    : "",
                ]
                  .filter(Boolean)
                  .join(" · ")}
                cancelState={cancelState}
                onDownload={() => void action("download", model)}
                onSelect={() => change({ dictationLocalModelPath: model.path })}
                onTest={() => void action("test", model)}
                onDelete={() => void requestDelete(model)}
                onCancel={() => void cancel()}
              />
            );
          })}
        </Disclosure>
      ) : null}
    </>
  );
}
