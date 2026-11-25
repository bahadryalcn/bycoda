import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { useConfirm } from "../../../shared/ui/ConfirmDialog";
import { Button } from "../../../shared/ui/Button";
import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { LoadingText } from "../../../shared/ui/LoadingText";
import { SettingsFeedback } from "../../../shared/ui/settings";
import { ModelLabel } from "../../sessions/public/ModelLabel";
import {
  localDictationModels,
  type LocalDictationModel,
  type LocalModelJob,
} from "../model/localDictationModels";
import { knownLocalModelMessage } from "../model/voiceEngineMessages";
import { voiceRuntimeSettings, type VoiceSettings } from "../model/voiceSettings";

const STATUS_POLL_MS = 1000;
const MAX_STATUS_RETRIES = 5;
const MAX_STATUS_RETRY_DELAY_MS = 16_000;

/** Browse and manage the two local Whisper models owned by voice setup. */
export function LocalDictationModels({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
  const [models, setModels] = useState<LocalDictationModel[]>([]);
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
        label={t("Local transcription models")}
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
              p1: operationLabel,
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
      {models.map((model) => (
        <Row
          key={model.id}
          id={`dictation-local-${model.id}`}
          label={<ModelLabel model={`openai/whisper-${model.id}`} name={model.label} />}
          description={
            model.installed
              ? settings.dictationLocalModelPath === model.path
                ? t("Selected")
                : t("Installed")
              : t("Not installed")
          }
        >
          {model.installed ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => change({ dictationLocalModelPath: model.path })}
              >
                {t("Select")}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
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
              variant="ghost"
              disabled={busy}
              loading={active("download", model.id)}
              loadingLabel={t("Downloading…")}
              onClick={() => void action("download", model)}
            >
              {t("Download")}
            </Button>
          )}
        </Row>
      ))}
    </>
  );
}
