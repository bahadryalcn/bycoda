import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { useModelSource } from "./modelSource";
import {
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { useT } from "../../../shared/i18n";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { copyMessage } from "../../../platform/tauri/clipboard";
import {
  translateSelection,
  canTranslate,
  translationErrorKind,
  type TranslationErrorKind,
  type TranslationContext,
  type TextActionTarget,
} from "../model/translation";
import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import { HARNESSES } from "../model/session";
import { defaultModelSettings, resolveModel } from "../model/models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { ModelPicker } from "./ModelPicker";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import styles from "./TranslationResultDialog.module.css";
import { translationContextWithDefault } from "../model/translationPreferences";

export function TranslationResultDialog({
  text,
  target,
  context,
  surroundingText,
  onApply,
  onClose,
}: {
  text: string;
  target: TextActionTarget;
  context: TranslationContext;
  surroundingText?: string;
  onApply: (translation: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const id = useId();
  const reprompt = target === "reprompt";
  const [translator, setTranslator] = useState(() =>
    translationContextWithDefault(context, reprompt ? "reprompt" : "translation"),
  );
  const [requested, setRequested] = useState(true);
  const source = useModelSource();
  useSyncExternalStore(
    subscribeHarnessAvailability,
    getHarnessAvailabilitySnapshot,
    getHarnessAvailabilitySnapshot,
  );
  const allowedHarnesses = HARNESSES.filter(
    (harness) => canRunHarnessTextPrompt(harness) && source.available(harness),
  );
  const [result, setResult] = useState("");
  const [error, setError] = useState<TranslationErrorKind | null>(null);
  // Copy has its own lifecycle so a clipboard failure never invalidates a valid result.
  const [copyState, setCopyState] = useState<"idle" | "pending" | "copied" | "error">("idle");
  const copyRun = useRef(0);
  const resetCopy = () => {
    copyRun.current += 1;
    setCopyState("idle");
  };
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(() => canTranslate(translator));
  const [applyError, setApplyError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const runnable = canTranslate(translator);
  useEffect(() => {
    if (!pending) return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [pending, attempt, translator]);
  useEffect(
    () => () => {
      copyRun.current += 1;
    },
    [],
  );
  useEffect(() => {
    if (!requested || !runnable) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    copyRun.current += 1;
    setCopyState("idle");
    setApplyError(false);
    setResult("");
    const onOutput = (output: string) => {
      if (!controller.signal.aborted) setResult(output);
    };
    const request = reprompt
      ? translateSelection(text, target, translator, controller.signal, surroundingText, onOutput)
      : translateSelection(text, target, translator, controller.signal, undefined, onOutput);
    void request
      .then((output) => {
        if (!controller.signal.aborted) setResult(output);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(translationErrorKind(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false);
      });
    return () => controller.abort();
  }, [text, target, attempt, translator, requested, reprompt, surroundingText, runnable]);
  const hintText = pending
    ? elapsed >= 12
      ? t("Taking longer than usual. You can cancel or choose another model.")
      : null
    : result && !error && reprompt
      ? t("After applying: ↑ original, ↓ rewritten prompt.")
      : result && !error
        ? t("After applying: ↑ original, ↓ translation.")
        : null;
  return (
    <Modal
      title={
        reprompt
          ? t("Reprompt")
          : target === "en"
            ? t("Translate to English")
            : t("Translate to Chinese")
      }
      description={
        reprompt
          ? t("Review the clearer prompt before applying it to your text.")
          : t("Review the translation before applying it to your text.")
      }
      size="lg"
      onClose={onClose}
      footer={
        <ModalActions
          start={
            hintText ? (
              <Text as="p" size="caption" tone="secondary" leading="normal" className={styles.hint}>
                {hintText}
              </Text>
            ) : undefined
          }
        >
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          {!requested && runnable && !!translator.model?.trim() ? (
            <Button
              variant="primary"
              onClick={() => {
                setRequested(true);
                setAttempt(attempt + 1);
              }}
            >
              {reprompt ? t("Reprompt") : t("Translate selected text")}
            </Button>
          ) : null}
          {error ? (
            <Button variant="primary" onClick={() => setAttempt(attempt + 1)}>
              {t("Retry")}
            </Button>
          ) : null}
          {result && !pending && !error ? (
            <Button
              variant="secondary"
              disabled={copyState === "pending"}
              loading={copyState === "pending"}
              onClick={async () => {
                if (copyState === "pending") return;
                const run = ++copyRun.current;
                setCopyState("pending");
                try {
                  await copyMessage(result);
                  if (copyRun.current === run) setCopyState("copied");
                } catch {
                  if (copyRun.current === run) setCopyState("error");
                }
              }}
            >
              {copyState === "copied"
                ? t("Copied")
                : copyState === "error"
                  ? t("Retry copy")
                  : t("Copy")}
            </Button>
          ) : null}
          <Button
            variant={result && !pending && !error ? "primary" : "secondary"}
            disabled={!result || pending || !!error}
            onClick={() => {
              try {
                onApply(result);
                onClose();
              } catch {
                setApplyError(true);
              }
            }}
          >
            {reprompt ? t("Apply prompt") : t("Apply translation")}
          </Button>
        </ModalActions>
      }
    >
      <Text
        as="div"
        size="body"
        tone="primary"
        leading="inherit"
        className={`bycoda-arc ${styles.content}`}
      >
        <div className={styles.modelRow}>
          <Text size="caption" tone="secondary" leading="inherit">
            {reprompt ? t("Reprompt model") : t("Translation model")}
          </Text>
          <ModelPicker
            harness={translator.harness}
            model={translator.model ?? ""}
            values={translator.modelSettings ?? {}}
            allowedHarnesses={allowedHarnesses}
            accountId={translator.providerAccountId}
            accountChoices
            onChange={(harness, model, accountId) => {
              setRequested(false);
              setPending(false);
              setResult("");
              setError(null);
              resetCopy();
              setTranslator({
                ...translator,
                harness,
                model,
                modelSettings: defaultModelSettings(resolveModel(harness, model)),
                providerAccountId: supportsProviderAccounts(harness)
                  ? (accountId ?? defaultProviderAccountId(harness))
                  : undefined,
              });
            }}
            onSettingsChange={(modelSettings) => {
              setRequested(false);
              setPending(false);
              setResult("");
              setError(null);
              resetCopy();
              setTranslator({ ...translator, modelSettings });
            }}
          />
        </div>
        <div className={styles.comparison}>
          <section
            {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.pane)}
            aria-labelledby={`${id}-original`}
          >
            <header className={styles.paneHeader}>
              <Heading size="item" id={`${id}-original`}>
                {t("Original text")}
              </Heading>
            </header>
            <Text
              as="div"
              size="inherit"
              tone="inherit"
              leading="relaxed"
              className={styles.text}
              tabIndex={0}
            >
              {text}
            </Text>
          </section>
          <section
            {...surfaceAttributes({ frame: "card", edge: "all", radius: "card" }, styles.pane)}
            aria-labelledby={`${id}-translation`}
            aria-busy={pending}
          >
            <header className={styles.paneHeader}>
              <Heading size="item" id={`${id}-translation`}>
                {reprompt ? t("Rewritten prompt") : t("Translation")}
              </Heading>
              <Text
                size="caption"
                tone="secondary"
                leading="inherit"
                className={styles.status}
                role="status"
              >
                {pending ? <Spinner size="xs" /> : null}
                {pending
                  ? reprompt
                    ? t("Rewriting…")
                    : t("Translating…")
                  : result && !error
                    ? t("Ready")
                    : t("Preview")}
                {pending ? (
                  <span aria-hidden="true" className={styles.elapsed}>
                    {elapsed}s
                  </span>
                ) : null}
              </Text>
            </header>
            <div className={styles.result}>
              {pending && !result ? (
                <Text
                  as="div"
                  size="inherit"
                  tone="secondary"
                  leading="relaxed"
                  className={styles.placeholder}
                >
                  <div aria-hidden="true" className={styles.skeleton}>
                    <span />
                    <span />
                    <span />
                  </div>
                </Text>
              ) : error ? (
                <Alert tone="danger">
                  {error === "authentication"
                    ? reprompt
                      ? t(
                          "Sign in to the selected provider in Settings > Providers, then retry reprompt.",
                        )
                      : t(
                          "Sign in to the selected provider in Settings > Providers, then retry translation.",
                        )
                    : error === "timeout"
                      ? reprompt
                        ? t("The reprompt request timed out. Try again.")
                        : t("The translation request timed out. Try again.")
                      : error === "unsupported-provider"
                        ? reprompt
                          ? t(
                              "This provider does not support reprompt requests. Choose another model.",
                            )
                          : t(
                              "This provider does not support translation requests yet. You can choose another translation model.",
                            )
                        : reprompt
                          ? t("Could not rewrite the prompt. Try again.")
                          : t("Could not translate. Try again.")}
                </Alert>
              ) : result ? (
                <Text
                  as="div"
                  size="inherit"
                  tone="inherit"
                  leading="relaxed"
                  tabIndex={0}
                  className={styles.text}
                >
                  {result}
                </Text>
              ) : (
                <Text
                  as="p"
                  role="status"
                  size="inherit"
                  tone="secondary"
                  leading="relaxed"
                  className={styles.placeholder}
                >
                  {!runnable
                    ? reprompt
                      ? t("This provider does not support reprompt requests. Choose another model.")
                      : t(
                          "This provider does not support translation requests yet. You can choose another translation model.",
                        )
                    : !translator.model?.trim()
                      ? reprompt
                        ? t("Choose a reprompt model.")
                        : t("Choose a translation model.")
                      : reprompt
                        ? t("Reprompt")
                        : t("Translate selected text")}
                </Text>
              )}
            </div>
          </section>
        </div>
        {applyError ? (
          <Alert tone="danger">
            {reprompt
              ? t("The text changed. Select it again to reprompt.")
              : t("The text changed. Select it again to translate.")}
          </Alert>
        ) : null}
        {copyState === "error" && result && !error ? (
          <Alert tone="danger">
            {reprompt
              ? t(
                  "Could not copy the rewritten prompt to the clipboard. The result is still here; try Copy again or apply it.",
                )
              : t(
                  "Could not copy the translation to the clipboard. The result is still here; try Copy again or apply it.",
                )}
          </Alert>
        ) : null}
      </Text>
    </Modal>
  );
}
