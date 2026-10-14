import { useEffect, useState, useSyncExternalStore } from "react";
import { useModelSource } from "./modelSource";
import {
  subscribeHarnessAvailability,
  getHarnessAvailabilitySnapshot,
} from "../../../integrations/harness/core/availability";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { copyMessage } from "../../../platform/tauri/clipboard";
import {
  translateSelection,
  canTranslate,
  canOfferTranslation,
  translationErrorKind,
  type TranslationErrorKind,
  type TranslationContext,
  type TranslationTarget,
} from "../model/translation";
import { canRunHarnessTextPrompt } from "../../../integrations/harness";
import { HARNESSES } from "../model/session";
import { defaultModelSettings, resolveModel } from "../model/models";
import {
  defaultProviderAccountId,
  supportsProviderAccounts,
} from "../../providers/model/providerAccounts";
import { ModelPicker } from "./ModelPicker";

const actionClass =
  "min-h-9 rounded-lg px-3 py-1.5 text-sm text-content hover:bg-content/5 active:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50";

export function TranslationResultDialog({
  text,
  target,
  context,
  onApply,
  onClose,
}: {
  text: string;
  target: TranslationTarget;
  context: TranslationContext;
  onApply: (translation: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const [translator, setTranslator] = useState(context);
  const [requested, setRequested] = useState(() => canTranslate(context));
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
  const [pending, setPending] = useState(() => canTranslate(context));
  const [applyError, setApplyError] = useState(false);
  useEffect(() => {
    if (!requested || !canOfferTranslation(translator)) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    void translateSelection(text, target, translator, controller.signal)
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
  }, [text, target, attempt, translator, requested]);
  return (
    <Modal
      title={target === "en" ? t("Translate to English") : t("Translate to Chinese")}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-content/70">{t("Translation model")}</span>
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
        {!translator.model?.trim() ? (
          <p role="status" className="text-sm text-content/70">
            {t("Choose a translation model.")}
          </p>
        ) : null}
        <p className="max-h-32 select-text overflow-auto whitespace-pre-wrap wrap-break-word text-sm text-content/60">
          {text}
        </p>
        {pending ? (
          <p role="status" className="text-sm text-content/70">
            {t("Translating…")}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-content/70">
            {error === "gemini-account"
              ? t(
                  "Gemini no longer supports this account or client. Check the Gemini account in Settings > Providers, or choose another provider.",
                )
              : error === "authentication"
                ? t(
                    "Sign in to the selected provider in Settings > Providers, then retry translation.",
                  )
                : error === "timeout"
                  ? t("The translation request timed out. Try again.")
                  : t("Could not translate. Try again.")}
          </p>
        ) : null}
        {result && !pending && !error ? (
          <p
            role="status"
            className="max-h-64 select-text overflow-auto whitespace-pre-wrap wrap-break-word text-sm text-content"
          >
            {result}
          </p>
        ) : null}
        {applyError ? (
          <p role="alert" className="text-sm text-content/70">
            {t("The text changed. Select it again to translate.")}
          </p>
        ) : null}
        <p className="text-xs text-content/60">{t("After applying: ↑ original, ↓ translation.")}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className={actionClass} onClick={onClose}>
            {t("Cancel")}
          </button>
          {!requested && canOfferTranslation(translator) && !!translator.model?.trim() ? (
            <button
              type="button"
              className={`${actionClass} bg-content/10`}
              onClick={() => {
                setRequested(true);
                setAttempt(attempt + 1);
              }}
            >
              {t("Translate selected text")}
            </button>
          ) : null}
          {error ? (
            <button type="button" className={actionClass} onClick={() => setAttempt(attempt + 1)}>
              {t("Retry")}
            </button>
          ) : null}
          <button
            type="button"
            className={actionClass}
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
          </button>
          <button
            type="button"
            className={`${actionClass} bg-content/10`}
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
            {t("Apply translation")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
