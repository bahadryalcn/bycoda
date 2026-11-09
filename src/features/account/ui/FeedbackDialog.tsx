import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError } from "../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { AiIdea, CircleAlert, Lock, MoreHorizontal, Star } from "../../../shared/ui/icons";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { useAccountState } from "../hooks/useAccount";
import { accountApi, reportAccountFailure } from "../model/accountApi";
import { accountDeviceInfo } from "../model/accountService";
import {
  EMPTY_FEEDBACK_DRAFT,
  FEEDBACK_KINDS,
  FEEDBACK_MESSAGE_MAX,
  submitFeedback,
  type FeedbackDraft,
  type FeedbackKind,
  type FeedbackSubmitResult,
} from "../model/feedback";
import { closeFeedbackDialog, useFeedbackDialogOpen } from "../model/feedbackDialog";
import { ContactByEmail } from "./AccountSupport";
import styles from "./FeedbackDialog.module.css";

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
      return <AiIdea size={18} />;
    case "problem":
      return <CircleAlert size={18} />;
    case "praise":
      return <Star size={18} />;
    case "other":
      return <MoreHorizontal size={18} />;
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

function Brand({ title, text, centered }: { title: string; text: string; centered?: boolean }) {
  return (
    <div className={`${styles.brand} ${centered ? styles.brandCentered : ""}`}>
      <img className={styles.logo} src={PRODUCT_IDENTITY.logoSrc} alt="" />
      <div>
        <h2 className={styles.brandTitle}>{title}</h2>
        <p className={styles.brandText}>{text}</p>
      </div>
    </div>
  );
}

function FeedbackForm({ signedIn }: { signedIn: boolean }) {
  const [draft, setDraft] = useState<FeedbackDraft>(EMPTY_FEEDBACK_DRAFT);
  const [result, setResult] = useState<FeedbackSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);

  if (result?.status === "sent") {
    return (
      <Modal
        title={t("Send feedback")}
        size="sm"
        minimalHeader
        onClose={closeFeedbackDialog}
        footer={
          <ModalActions>
            <Button variant="primary" onClick={closeFeedbackDialog}>
              {t("Close")}
            </Button>
          </ModalActions>
        }
      >
        <Brand
          centered
          title={t("Thank you!")}
          text={t("Thank you for your feedback. Reference: {p0}", {
            p0: result.reference,
          })}
        />
      </Modal>
    );
  }

  const length = draft.message.trim().length;
  const send = async () => {
    setBusy(true);
    try {
      setResult(
        await submitFeedback(accountApi(), draft, signedIn, {
          deviceInfo: accountDeviceInfo,
          onFailure: reportAccountFailure,
        }),
      );
    } catch {
      setResult({ status: "failed" }); // -- the account API is not ready yet; the draft stays.
    } finally {
      setBusy(false);
    }
  };
  const invalid = result?.status === "invalid" ? result.issues[0] : undefined;

  return (
    <Modal
      title={t("Send feedback")}
      size="sm"
      minimalHeader
      onClose={closeFeedbackDialog}
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={closeFeedbackDialog}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="feedback-form"
            loading={busy}
            disabled={length === 0}
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
        <Brand
          title={t("Help shape {p0}", { p0: PRODUCT_IDENTITY.displayName })}
          text={t("Tell us what works, what does not and what you wish existed.")}
        />
        <RadioGroup
          variant="tiles"
          label={t("Kind of feedback")}
          className={styles.kinds}
          tileClassName={styles.kind}
          value={draft.kind}
          options={FEEDBACK_KINDS.map((value) => ({
            value,
            content: (
              <>
                {kindIcon(value)}
                <span>{kindLabel(value)}</span>
              </>
            ),
          }))}
          onValueChange={(value) => setDraft({ ...draft, kind: value as FeedbackKind })}
        />
        <TextareaField
          label={t("Message")}
          hideLabel
          placeholder={kindPlaceholder(draft.kind)}
          value={draft.message}
          minRows={5}
          maxRows={12}
          autosize
          description={`${length}/${FEEDBACK_MESSAGE_MAX}`}
          error={
            invalid === "message-missing"
              ? t("Add a message.")
              : invalid === "message-long"
                ? t("Use at most {p0} characters.", {
                    p0: FEEDBACK_MESSAGE_MAX,
                  })
                : undefined
          }
          onChange={(event) => setDraft({ ...draft, message: event.target.value })}
        />
        <div className={styles.ratingRow}>
          <span className={styles.ratingLabel}>{t("How is your experience? (optional)")}</span>
          <RadioGroup
            variant="tiles"
            label={t("Rating")}
            className={styles.stars}
            tileClassName={styles.star}
            tile={{ variant: "ghost", size: "sm" }}
            value={draft.rating === null ? "" : String(draft.rating)}
            options={[1, 2, 3, 4, 5].map((n) => ({
              value: String(n),
              ariaLabel: t("{p0} of 5", { p0: n }),
              className: draft.rating !== null && n <= draft.rating ? styles.starOn : undefined,
              content: <Star size={18} />,
            }))}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                rating: Number(value) === draft.rating ? null : Number(value),
              })
            }
          />
          {draft.rating !== null ? (
            <Button variant="ghost" size="sm" onClick={() => setDraft({ ...draft, rating: null })}>
              {t("Clear rating")}
            </Button>
          ) : null}
        </div>
        <Checkbox
          className="text-ui-secondary"
          label={t("Include app version and system")}
          description={t("App version, platform, OS version and release channel.")}
          checked={draft.includeContext}
          onChange={(event) => setDraft({ ...draft, includeContext: event.target.checked })}
        />
        <p className={styles.privacy}>
          <Lock size={12} />
          {t("Only what you write is sent. Do not paste secrets.")}
        </p>
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
        <p className="text-ui-body text-content">
          {t("Sending feedback from the app is not available in this build.")}
        </p>
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
  if (!open) return null;
  return state.phase === "unavailable" ? (
    <FeedbackElsewhere />
  ) : (
    <FeedbackForm signedIn={state.phase === "signed-in"} />
  );
}
