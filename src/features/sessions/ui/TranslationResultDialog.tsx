import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { useModelSource } from "./modelSource";
import {
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { useT } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { copyMessage } from "../../../platform/tauri/clipboard";
import {
  translateSelection,
  canTranslate,
  canOfferTranslation,
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
  const [requested, setRequested] = useState(() => canTranslate(translator));
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
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(() => canTranslate(translator));
  const [applyError, setApplyError] = useState(false);
  useEffect(() => {
    if (!requested || !canOfferTranslation(translator)) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setCopied(false);
    setApplyError(false);
    const request = reprompt
      ? translateSelection(text, target, translator, controller.signal, surroundingText)
      : translateSelection(text, target, translator, controller.signal);
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
  }, [text, target, attempt, translator, requested, reprompt, surroundingText]);
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
    >
      <div className={`bycoda-arc ${styles.content}`}>
        <div className={styles.modelRow}>
          <span className={styles.secondary}>
            {reprompt ? t("Reprompt model") : t("Translation model")}
          </span>
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
              setCopied(false);
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
              setTranslator({ ...translator, modelSettings });
            }}
          />
        </div>
        <div className={styles.comparison}>
          <section className={styles.pane} aria-labelledby={`${id}-original`}>
            <header className={styles.paneHeader}>
              <h3 id={`${id}-original`}>{t("Original text")}</h3>
            </header>
            <div className={styles.text} tabIndex={0}>
              {text}
            </div>
          </section>
          <section
            className={styles.pane}
            aria-labelledby={`${id}-translation`}
            aria-busy={pending}
          >
            <header className={styles.paneHeader}>
              <h3 id={`${id}-translation`}>
                {reprompt ? t("Rewritten prompt") : t("Translation")}
              </h3>
              <span className={styles.secondary}>
                {pending
                  ? reprompt
                    ? t("Rewriting…")
                    : t("Translating…")
                  : result && !error
                    ? t("Ready")
                    : t("Preview")}
              </span>
            </header>
            <div className={styles.result}>
              {pending ? (
                <div role="status" className={styles.placeholder}>
                  <p>{reprompt ? t("Rewriting…") : t("Translating…")}</p>
                  <div aria-hidden="true" className={styles.skeleton}>
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ) : error ? (
                <Alert tone="danger" role="alert">
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
                <div role="status" tabIndex={0} className={styles.text}>
                  {result}
                </div>
              ) : (
                <p role="status" className={styles.placeholder}>
                  {!translator.model?.trim()
                    ? reprompt
                      ? t("Choose a reprompt model.")
                      : t("Choose a translation model.")
                    : reprompt
                      ? t("Reprompt")
                      : t("Translate selected text")}
                </p>
              )}
            </div>
          </section>
        </div>
        {applyError ? (
          <Alert tone="danger" role="alert">
            {reprompt
              ? t("The text changed. Select it again to reprompt.")
              : t("The text changed. Select it again to translate.")}
          </Alert>
        ) : null}
        <footer className={styles.footer}>
          <p className={styles.hint}>
            {reprompt
              ? t("After applying: ↑ original, ↓ rewritten prompt.")
              : t("After applying: ↑ original, ↓ translation.")}
          </p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={onClose}>
              {t("Cancel")}
            </Button>
            {!requested && canOfferTranslation(translator) && !!translator.model?.trim() ? (
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
            <Button
              variant="secondary"
              disabled={!result || pending || !!error}
              onClick={async () => {
                try {
                  await copyMessage(result);
                  setCopied(true);
                } catch {
                  setError("generic");
                }
              }}
            >
              {copied ? t("Copied") : t("Copy")}
            </Button>
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
          </div>
        </footer>
      </div>
    </Modal>
  );
}
