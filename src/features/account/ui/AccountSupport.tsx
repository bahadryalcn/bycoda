import { Text } from "../../../shared/ui/Text";
import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { Divider } from "../../../shared/ui/Divider";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Star } from "../../../shared/ui/icons";
import { Select } from "../../../shared/ui/Select";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { accountApi, reportAccountFailure } from "../model/accountApi";
import {
  EMPTY_SUPPORT_DRAFT,
  SUPPORT_BODY_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_SUBJECT_MAX,
  submitSupportTicket,
  type SupportCategory,
  type SupportDraft,
  type SupportDraftIssue,
  type SupportSubmitResult,
} from "../model/supportTicket";
import { openFeedbackDialog } from "../model/feedbackDialog";
import styles from "./account.module.css";

function categoryLabel(category: SupportCategory): string {
  switch (category) {
    case "bug":
      return t("Something is broken");
    case "feature":
      return t("Feature request");
    case "account":
      return t("My account");
    case "privacy":
      return t("Privacy");
    case "other":
      return t("Other");
  }
}

function issueText(issue: SupportDraftIssue): string {
  switch (issue) {
    case "subject-missing":
      return t("Add a subject.");
    case "body-missing":
      return t("Add a message.");
    case "subject-long":
      return t("Use at most {p0} characters.", { p0: SUPPORT_SUBJECT_MAX });
    case "body-long":
      return t("Use at most {p0} characters.", { p0: SUPPORT_BODY_MAX });
  }
}

/** Opens the user's mail app; nothing is attached or sent by bycoda. */
export function ContactByEmail() {
  useLocale();
  const [failed, setFailed] = useState(false);
  const address = PRODUCT_IDENTITY.contactEmail;
  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          onClick={() => {
            setFailed(false);
            openExternal(`mailto:${address}`).catch(() => setFailed(true));
          }}
        >
          {t("Contact by e-mail")}
        </Button>
      </div>
      {failed ? (
        <InlineError>
          {t("Could not open your email app. Copy {p0} into your email app.", { p0: address })}
        </InlineError>
      ) : null}
    </>
  );
}

/** Opens the project repository in the browser; absent when the build has no repository. */
export function ProjectLinks() {
  useLocale();
  const [failed, setFailed] = useState(false);
  const url = PRODUCT_IDENTITY.repositoryUrl;
  if (!url) return null;
  return (
    <>
      <div className={styles.actions}>
        <Button
          variant="secondary"
          startIcon={<Star strokeWidth={1.75} aria-hidden />}
          onClick={() => {
            setFailed(false);
            openExternal(url).catch(() => setFailed(true));
          }}
        >
          {t("View on GitHub")}
        </Button>
      </div>
      {failed ? (
        <InlineError>
          {t("Could not open the link. Copy the address and open it manually.")}
        </InlineError>
      ) : null}
    </>
  );
}

/** The guest panel's only support entry: a mail link, since tickets need an account. */
export function GuestSupport() {
  useLocale();
  return (
    <section className={styles.section} aria-labelledby="account-guest-support">
      <SectionLabel labelId="account-guest-support">{t("Support")}</SectionLabel>
      <Text as="p" size="body" tone="secondary" className={styles.lead}>
        {t("Questions or problems? Write to us.")}
      </Text>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={openFeedbackDialog}>
          {t("Send feedback")}
        </Button>
      </div>
      <ContactByEmail />
      <ProjectLinks />
    </section>
  );
}

/** A support ticket written by the user. The draft survives every failure. */
export function AccountSupport() {
  useLocale();
  const [draft, setDraft] = useState<SupportDraft>(EMPTY_SUPPORT_DRAFT);
  const [result, setResult] = useState<SupportSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  const issues = result?.status === "invalid" ? result.issues : [];
  const issue = (...names: SupportDraftIssue[]) => {
    const found = issues.find((name) => names.includes(name));
    return found ? issueText(found) : undefined;
  };

  const send = async () => {
    setBusy(true);
    try {
      const next = await submitSupportTicket(accountApi(), draft, reportAccountFailure);
      setResult(next);
      if (next.status === "sent") setDraft(EMPTY_SUPPORT_DRAFT);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.section} aria-labelledby="account-support">
      <SectionLabel labelId="account-support">{t("Contact support")}</SectionLabel>
      <Text as="p" size="body" tone="secondary" className={styles.lead}>
        {t(
          "Nothing from your sessions, code, logs or file paths is attached automatically. Do not paste passwords, tokens or other secrets.",
        )}
      </Text>
      {result?.status === "sent" ? (
        <InlineMessage tone="success">
          {t("Your request was sent. Reference: {p0}", { p0: result.reference })}
        </InlineMessage>
      ) : null}
      <Select
        label={t("Category")}
        value={draft.category}
        options={SUPPORT_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
        onValueChange={(value) => setDraft({ ...draft, category: value as SupportCategory })}
      />
      <TextField
        label={t("Subject")}
        value={draft.subject}
        error={issue("subject-missing", "subject-long")}
        onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
      />
      <TextareaField
        label={t("Message")}
        value={draft.body}
        minRows={5}
        maxRows={14}
        autosize
        error={issue("body-missing", "body-long")}
        onChange={(event) => setDraft({ ...draft, body: event.target.value })}
      />
      {result?.status === "rate-limited" ? (
        <InlineError>
          {t("Too many requests. Wait a little and try again; your message is kept.")}
        </InlineError>
      ) : null}
      {result?.status === "failed" ? (
        <InlineError>{t("Could not send your request. Your message is kept.")}</InlineError>
      ) : null}
      <div className={styles.actions}>
        <Button variant="primary" loading={busy} onClick={send}>
          {t("Send to support")}
        </Button>
      </div>
      <Divider />
      <div className={styles.actions}>
        <Button variant="secondary" onClick={openFeedbackDialog}>
          {t("Send feedback")}
        </Button>
        <ContactByEmail />
        <ProjectLinks />
      </div>
    </section>
  );
}
