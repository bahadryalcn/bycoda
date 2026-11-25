import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { AiIdea, CircleAlert, MoreHorizontal, Star } from "../../../shared/ui/icons";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { diagnosticResultText, getDiagnosticsMode, sendDiagnosticLogs } from "../../diagnostics";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { useAccountState } from "../hooks/useAccount";
import { accountApi, reportAccountFailure } from "../model/accountApi";
import { accountDeviceInfo } from "../model/accountService";
import {
  EMPTY_FEEDBACK_DRAFT,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  submitFeedback,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackSubmitResult,
} from "../model/feedback";
import { closeFeedbackDialog, useFeedbackDialogOpen } from "../model/feedbackDialog";
import { ContactByEmail } from "./AccountSupport";

function kindLabel(kind: FeedbackKind): string {
  switch (kind) {
    case "idea":
      return t("Idea");
    case "problem":
      return t("Problem");
    case "praise":
      return t("Praise");
    case "other":
      return t("Other");
  }
}

function kindIcon(kind: FeedbackKind) {
  switch (kind) {
    case "idea":
      return <AiIdea className="icon-lg" />;
    case "problem":
      return <CircleAlert className="icon-lg" />;
    case "praise":
      return <Star className="icon-lg" />;
    case "other":
      return <MoreHorizontal className="icon-lg" />;
  }
}

function kindPlaceholder(kind: FeedbackKind): string {
  switch (kind) {
    case "idea":
      return t("What would make bycoda better for you? Describe the idea and why it would help.");
    case "problem":
      return t("What went wrong? Tell us what you did, what you expected and what happened.");
    case "praise":
      return t("What do you enjoy most? Tell us what is working well for you.");
    case "other":
      return t("Anything else on your mind? We read every message.");
  }
}

function FeedbackForm({ signedIn, open }: { signedIn: boolean; open: boolean }) {
  const [draft, setDraft] = useState<FeedbackDraft>(() => ({
    ...EMPTY_FEEDBACK_DRAFT,
    attachLogs: getDiagnosticsMode() === "auto",
  }));
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Any edit makes the last outcome stale. A send still in flight keeps its outcome: it sets
  // `result` when it settles, so the dialog shows it on the next open.
  const edit = (next: FeedbackDraft) => {
    setDraft(next);
    setResult(null);
  };
  const close = () => {
    if (!busy) setResult(null);
    closeFeedbackDialog();
  };

  if (!open) return null;

  const length = draft.message.trim().length;
  const send = async () => {
    setBusy(true);
    setResult(null);
    try {
      const next = await submitFeedback(accountApi(), draft, signedIn, {
        deviceInfo: accountDeviceInfo,
        onFailure: reportAccountFailure,
        sendLogs: ({ feedbackId, note }) =>
          sendDiagnosticLogs({ trigger: "feedback", feedbackId, note }),
      });
      if (next.status === "sent")
        setDraft((current) =>
          current === draft
            ? { ...EMPTY_FEEDBACK_DRAFT, attachLogs: getDiagnosticsMode() === "auto" }
            : current,
        );
      setResult(next);
    } catch {
      setResult({ status: "failed" }); // -- the account API is not ready yet; the draft stays.
    } finally {
      setBusy(false);
    }
  };
  // Derived from the draft as it is now, and only while the last send was rejected.
  const invalid = result?.status === "invalid" ? validateFeedbackDraft(draft)[0] : undefined;

  return (
    <Modal
      title={t("Send feedback")}
      size="sm"
      minimalHeader
      onClose={close}
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={close}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="feedback-form"
            loading={busy}
            disabled={length === 0}
            disabledReason={length === 0 ? t("Add a message.") : undefined}
          >
            {t("Send")}
          </Button>
        </ModalActions>
      }
    >
      <form
        id="feedback-form"
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) send().catch(() => undefined);
        }}
      >
        <RadioGroup
          variant="tiles"
          label={t("Kind of feedback")}
          tileLayout="portrait"
          tile={{ selectionIndicator: "subtle-ring" }}
          value={draft.kind}
          options={FEEDBACK_KINDS.map((value) => ({
            value,
            content: (
              <span className="flex flex-col items-center gap-1">
                {kindIcon(value)}
                <span>{kindLabel(value)}</span>
              </span>
            ),
          }))}
          onValueChange={(value) => edit({ ...draft, kind: value as FeedbackKind })}
        />
        <TextareaField
          label={t("Message")}
          hideLabel
          placeholder={kindPlaceholder(draft.kind)}
          value={draft.message}
          minRows={5}
          maxRows={12}
          autosize
          description={
            length > FEEDBACK_MESSAGE_MAX * 0.8 ? `${length}/${FEEDBACK_MESSAGE_MAX}` : undefined
          }
          error={
            invalid === "message-missing"
              ? t("Add a message.")
              : invalid === "message-long"
                ? t("Use at most {p0} characters.", {
                    p0: FEEDBACK_MESSAGE_MAX,
                  })
                : undefined
          }
          onChange={(event) => edit({ ...draft, message: event.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Text size="caption" tone="secondary" leading="inherit">
            {t("How is your experience? (optional)")}
          </Text>
          <RadioGroup
            variant="tiles"
            label={t("Rating")}
            tileLayout="icon"
            tile={{ variant: "ghost", size: "sm" }}
            value={draft.rating === null ? "" : String(draft.rating)}
            options={[1, 2, 3, 4, 5].map((n) => ({
              value: String(n),
              ariaLabel: t("{p0} of 5", { p0: n }),
              content: (
                <Star
                  className="icon-lg"
                  tone={draft.rating !== null && n <= draft.rating ? "warning" : "secondary"}
                />
              ),
            }))}
            onValueChange={(value) =>
              edit({
                ...draft,
                rating: Number(value) === draft.rating ? null : Number(value),
              })
            }
          />
        </div>
        <Checkbox
          size="secondary"
          label={t("Include app version and system")}
          checked={draft.includeContext}
          onChange={(event) => edit({ ...draft, includeContext: event.target.checked })}
        />
        <Checkbox
          size="secondary"
          label={t("Attach diagnostic logs")}
          checked={draft.attachLogs}
          onChange={(event) => edit({ ...draft, attachLogs: event.target.checked })}
        />
        <Text as="p" size="caption" tone="secondary" leading="inherit">
          {t(
            "Only what you write and the options ticked above are sent; logs never include your conversations. Do not paste secrets.",
          )}
        </Text>
        {result?.status === "sent" ? (
          <>
            <InlineMessage tone="success">
              {t("Thank you for your feedback. Reference: {p0}", { p0: result.reference })}
            </InlineMessage>
            {result.logs && result.logs !== "sent" ? (
              <InlineMessage tone="warning">
                {t("Your feedback was sent, but the logs were not. {p0}", {
                  p0: diagnosticResultText(result.logs),
                })}
              </InlineMessage>
            ) : null}
          </>
        ) : null}
        {result?.status === "rate-limited" ? (
          <InlineError>
            {t("Too many requests. Wait a little and try again; your message is kept.")}
          </InlineError>
        ) : null}
        {result?.status === "failed" ? (
          <InlineError>{t("Could not send your feedback. Your message is kept.")}</InlineError>
        ) : null}
      </form>
    </Modal>
  );
}

/** Without the account platform feedback goes to the public repository or by e-mail. */
function FeedbackElsewhere() {
  const [failed, setFailed] = useState(false);
  const repositoryUrl = PRODUCT_IDENTITY.repositoryUrl;
  return (
    <Modal title={t("Send feedback")} size="sm" onClose={closeFeedbackDialog}>
      <div className="flex flex-col gap-3">
        <Text as="p" size="body" tone="primary">
          {t("Sending feedback from the app is not available in this build.")}
        </Text>
        <div className="flex flex-wrap gap-2">
          {repositoryUrl ? (
            <Button
              variant="secondary"
              onClick={() => {
                setFailed(false);
                openExternal(`${repositoryUrl.replace(/\/+$/, "")}/issues/new`).catch(() =>
                  setFailed(true),
                );
              }}
            >
              {t("Open an issue on GitHub")}
            </Button>
          ) : null}
          <ContactByEmail />
        </div>
        {failed ? <InlineError>{t("Could not open the link.")}</InlineError> : null}
      </div>
    </Modal>
  );
}

/** The one feedback dialog, mounted once at app level and opened by `openFeedbackDialog()`. */
export function FeedbackDialog() {
  useLocale();
  const open = useFeedbackDialogOpen();
  const state = useAccountState();
  return state.phase === "unavailable" ? (
    open ? (
      <FeedbackElsewhere />
    ) : null
  ) : (
    <FeedbackForm signedIn={state.phase === "signed-in"} open={open} />
  );
}
