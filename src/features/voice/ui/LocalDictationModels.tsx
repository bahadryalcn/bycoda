import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { useEffect, useRef, useState } from "react";
import { t, useFormat, useLocale } from "../../../shared/i18n";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { Select, SettingsFeedback } from "../../../shared/ui/settings";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import {
  localDictationModels,
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
const PAGE_SIZE = 8;

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
  const [languageFilter, setLanguageFilter] = useState("");
  const [sort, setSort] = useState("recommended");
  const [limit, setLimit] = useState(PAGE_SIZE);
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
  const [cancelState, setCancelState] = useState<"requesting" | "requested" | null>(null);
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
  const activeModel = models.find((model) => model.id === operation.id);
  const selectedModel = models.find((model) => model.path === settings.dictationLocalModelPath);
  const preferred =
    settings.dictationLanguage === "auto"
      ? detected || locale.split("-")[0]
      : settings.dictationLanguage;
  const preferredLabel = DICTATION_LANGUAGES.find(([id]) => id === preferred)?.[1];
  const supportsLanguage = (model: LocalDictationModel, language: string) =>
    !language || !model.languages || model.languages.includes(language);
  const rank = (model: LocalDictationModel) =>
    Number(model.path === settings.dictationLocalModelPath) * 8 +
    Number(supportsLanguage(model, preferred)) * 4 +
    Number(model.installed) * 2 +
    Number(Boolean(model.recommended));
  const visibleModels = models
    .filter(
      (model) =>
        (filter !== "installed" || model.installed) &&
        supportsLanguage(model, languageFilter) &&
        model.label.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((left, right) =>
      sort === "size" ? (left.sizeBytes ?? 0) - (right.sizeBytes ?? 0) : rank(right) - rank(left),
    );
  const operationLabel =
    operation.action === "download"
      ? t("Downloading…")
      : operation.action === "delete"
        ? t("Deleting…")
        : t("Testing…");
  const active = (action: LocalModelJob["action"], id: string) =>
    busy && operation.action === action && operation.id === id;
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
  return (
    <>
      {dialog}
      <Row
        id="dictation-local-models"
        label={selectedModel?.label ?? t("Dictation model")}
        feedback={
          actionNotice || job.state === "error" ? (
            <SettingsFeedback
              state="error"
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
        {settings.dictationLocalModelPath ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => change({ dictationLocalModelPath: "" })}
          >
            {t("Use automatic selection")}
          </Button>
        ) : null}
        {actionNotice ? (
          <Button
            variant="ghost"
            onClick={() => {
              setLoading(true);
              setActionNotice("");
              setRevision((value) => value + 1);
            }}
          >
            {t("Try again")}
          </Button>
        ) : null}
        {busy ? (
          <LoadingText delay={false}>
            {t("{p0}: {p1}", {
              p0: activeModel?.label ?? operation.id ?? t("Local transcription models"),
              p1:
                job.state === "working" && job.bytesDone !== undefined && job.bytesTotal
                  ? `${operationLabel} ${formatBytes(job.bytesDone)} / ${formatBytes(job.bytesTotal)}`
                  : operationLabel,
            })}
          </LoadingText>
        ) : null}
        {job.state === "working" && !pending ? (
          <Button
            variant="ghost"
            disabled={cancelState !== null}
            disabledReason={t("Cancellation was already requested.")}
            loading={cancelState === "requesting"}
            loadingLabel={t("Requesting cancellation…")}
            onClick={() => void cancel()}
          >
            {cancelState === "requested" ? t("Cancellation requested") : t("Cancel")}
          </Button>
        ) : null}
      </Row>
      {loading ? <LoadingText>{t("Loading models…")}</LoadingText> : null}
      {!loading && !actionNotice && !models.length ? (
        <EmptyState size="inline" description={t("No local transcription models found.")} />
      ) : null}
      {models.length > 0 ? (
        <Row label={t("Find a local model")} stacked>
          <div className="flex flex-wrap gap-2">
            <SearchInput
              containerClassName="min-w-0 flex-1 basis-48"
              aria-label={t("Search models")}
              placeholder={t("Search models")}
              appearance="field"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(PAGE_SIZE);
              }}
            />
            <Select
              hideLabel
              label={t("Model availability")}
              value={filter}
              options={[
                { value: "all", label: t("All models") },
                { value: "installed", label: t("Installed") },
              ]}
              onChange={(value) => {
                setFilter(value);
                setLimit(PAGE_SIZE);
              }}
            />
            <Select
              hideLabel
              label={t("Model language")}
              value={languageFilter}
              options={[
                { value: "", label: t("All languages") },
                ...DICTATION_LANGUAGES.map(([value, label]) => ({ value, label })),
              ]}
              onChange={(value) => {
                setLanguageFilter(value);
                setLimit(PAGE_SIZE);
              }}
            />
            <Select
              hideLabel
              label={t("Sort models")}
              value={sort}
              options={[
                { value: "recommended", label: t("Recommended") },
                { value: "size", label: t("Smallest first") },
              ]}
              onChange={(value) => {
                setSort(value);
                setLimit(PAGE_SIZE);
              }}
            />
          </div>
        </Row>
      ) : null}
      {models.length > 0 && visibleModels.length === 0 ? (
        <EmptyState
          size="inline"
          context="list"
          kind="filtered"
          description={t("No matching models.")}
          onReset={() => {
            setQuery("");
            setFilter("all");
            setLanguageFilter("");
            setLimit(PAGE_SIZE);
          }}
        />
      ) : null}
      {visibleModels.slice(0, limit).map((model) => (
        <Row
          key={model.id}
          id={`dictation-local-${model.id}`}
          label={
            model.format === "gguf" ? (
              model.label
            ) : (
              <ModelLabel model={`openai/whisper-${model.id}`} name={model.label} />
            )
          }
          descriptionVisible
          description={[
            model.available === false
              ? t("Unavailable on this platform")
              : model.installed
                ? settings.dictationLocalModelPath === model.path
                  ? t("Selected")
                  : t("Installed")
                : t("Not installed"),
            model.sizeBytes ? formatBytes(model.sizeBytes) : "",
            model.format === "faster-whisper"
              ? "Faster Whisper"
              : model.format === "gguf"
                ? "GGUF"
                : "",
            preferredLabel && supportsLanguage(model, preferred) && model.languages
              ? preferredLabel
              : "",
            model.recommended && supportsLanguage(model, preferred) ? t("Recommended") : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {model.installed ? (
            <>
              <Button
                variant={settings.dictationLocalModelPath === model.path ? "ghost" : "secondary"}
                disabled={
                  busy ||
                  model.available === false ||
                  settings.dictationLocalModelPath === model.path
                }
                onClick={() => change({ dictationLocalModelPath: model.path })}
              >
                {settings.dictationLocalModelPath === model.path ? t("Selected") : t("Select")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy || model.available === false}
                loading={active("test", model.id)}
                loadingLabel={t("Testing…")}
                onClick={() => void action("test", model)}
              >
                {t("Test model load")}
              </Button>
              <Button
                variant="ghost"
                tone="danger"
                disabled={busy}
                loading={active("delete", model.id)}
                loadingLabel={t("Deleting…")}
                onClick={() => void requestDelete(model)}
              >
                {t("Delete")}
              </Button>
            </>
          ) : (
            <Button
              variant="secondary"
              disabled={busy || model.available === false}
              loading={active("download", model.id)}
              loadingLabel={t("Downloading…")}
              onClick={() => void action("download", model)}
            >
              {t("Download")}
            </Button>
          )}
        </Row>
      ))}
      {visibleModels.length > limit ? (
        <Row label={t("More transcription models")}>
          <Button onClick={() => setLimit(limit + PAGE_SIZE)}>{t("Show more")}</Button>
        </Row>
      ) : null}
    </>
  );
}
