import { useQuery } from "@tanstack/react-query";
import { SkeletonBar } from "../../../shared/ui/Skeleton";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { Heading } from "../../../shared/ui/Heading";
import { Alert } from "../../../shared/ui/Alert";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { usePresentationNow } from "./AgentClock";
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
import { CopyButton } from "../../../shared/ui/CopyButton";
import { Spinner } from "../../../shared/ui/Spinner";
import styles from "./TranslationResultDialog.module.css";
import {
  translationContextWithDefault,
  queryTranslationContext,
} from "../model/translationPreferences";

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
  const [translator, setTranslator] = useState(() => translationContextWithDefault(context));
  const [requested, setRequested] = useState(true);
  const [modelEdited, setModelEdited] = useState(false);
  const routing = useQuery({
    queryKey: ["translation-role", context, reprompt ? "reprompt" : "translation"] as const,
    queryFn: queryTranslationContext,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const routingReady = !routing.isPending;
  const [seededRouting, setSeededRouting] = useState<typeof routing.data>();
  if (routing.data && routing.data !== seededRouting) {
    setSeededRouting(routing.data);
    if (!modelEdited) setTranslator(routing.data);
  }
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
  const [copyFailed, setCopyFailed] = useState(false);
  const resetCopy = () => setCopyFailed(false);
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(() => canTranslate(translator));
  const [applyError, setApplyError] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const runStarted = useRef(0);
  const now = usePresentationNow(pending);
  const runnable = canTranslate(translator);
  // Each pending run restarts the count; the seconds below are read on the shared clock.
  useEffect(() => {
    if (!pending) return;
    runStarted.current = Date.now();
    setElapsed(0);
  }, [pending, attempt, translator]);
  useEffect(() => {
    if (!pending) return;
    setElapsed(Math.max(0, Math.floor((now - runStarted.current) / 1000)));
  }, [now, pending]);
  useEffect(() => {
    if (!routingReady || !requested || !runnable) return;
    const controller = new AbortController();
    setPending(true);
    setError(null);
    setCopyFailed(false);
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
  }, [
    text,
    target,
    attempt,
    translator,
    requested,
    reprompt,
    surroundingText,
    runnable,
    routingReady,
  ]);
  const hintText =
    pending && elapsed >= 12
      ? t("Taking longer than usual. You can cancel or choose another model.")
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
          {result && !pending && !error ? (
            <CopyButton
              variant="secondary"
              label={t("Copy")}
              resetKeys={[result]}
              onClick={() => setCopyFailed(false)}
              onCopy={() => copyMessage(result)}
              onCopyError={() => setCopyFailed(true)}
            />
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
          <ModelPicker
            harness={translator.harness}
            model={translator.model ?? ""}
            values={translator.modelSettings ?? {}}
            allowedHarnesses={allowedHarnesses}
            accountId={translator.providerAccountId}
            accountChoices
            onChange={(harness, model, accountId) => {
              setModelEdited(true);
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
              setModelEdited(true);
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
            {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the scrollable text box must stay keyboard-scrollable */}
            <div className={styles.text} tabIndex={0}>
              <Text as="div" size="inherit" tone="inherit" leading="relaxed">
                {text}
              </Text>
            </div>
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
              <Text size="caption" tone="secondary" leading="inherit">
                <span className={styles.status} role="status">
                  {pending ? <Spinner size="xs" /> : null}
                  {pending ? (reprompt ? t("Rewriting…") : t("Translating…")) : null}
                  {pending ? (
                    <span aria-hidden="true" className={styles.elapsed}>
                      {elapsed}s
                    </span>
                  ) : null}
                </span>
              </Text>
            </header>
            <div className={styles.result}>
              {pending && !result ? (
                <div className={styles.placeholder}>
                <Text as="div" size="inherit" tone="secondary" leading="relaxed">
                  <div aria-hidden="true" className={styles.skeleton}>
                    <SkeletonBar height="8px" />
                    <SkeletonBar height="8px" index={1} />
                    <SkeletonBar height="8px" width="65%" index={2} />
                  </div>
                </Text>
                </div>
              ) : error ? (
                <Alert
                  tone="danger"
                  action={{ label: t("Retry"), onClick: () => setAttempt(attempt + 1) }}
                >
                  {error === "authentication"
                    ? reprompt
                      ? t(
                          "Sign in to the selected provider in Settings → Providers, then retry reprompt.",
                        )
                      : t(
                          "Sign in to the selected provider in Settings → Providers, then retry translation.",
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
                // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the scrollable result box must stay keyboard-scrollable
                <div tabIndex={0} className={styles.text}>
                  <Text as="div" size="inherit" tone="inherit" leading="relaxed">
                    {result}
                  </Text>
                </div>
              ) : (
                <div role="status" className={styles.placeholder}>
                <Text as="p" size="inherit" tone="secondary" leading="relaxed">
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
                      : null}
                </Text>
                </div>
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
        ) : copyFailed && result && !error ? (
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
