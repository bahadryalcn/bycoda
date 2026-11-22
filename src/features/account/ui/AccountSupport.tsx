import { useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { Select } from "../../../shared/ui/Select";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { Group, Row } from "../../../shared/ui/settings";
import { accountApi, reportAccountFailure } from "../model/accountApi";
import {
  EMPTY_SUPPORT_DRAFT,
  SUPPORT_BODY_MAX,
  SUPPORT_CATEGORIES,
  SUPPORT_SUBJECT_MAX,
  submitSupportTicket,
  validateSupportDraft,
  type SupportCategory,
  type SupportDraft,
  type SupportDraftIssue,
  type SupportSubmitResult,
} from "../model/supportTicket";
import { openFeedbackDialog } from "../model/feedbackDialog";
import { AccountExternalLink } from "./AccountExternalLink";
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
          size="sm"
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
  const url = PRODUCT_IDENTITY.repositoryUrl;
  if (!url) return null;
  return <AccountExternalLink url={url} label={t("View on GitHub")} />;
}

/** The guest panel's only support entry: a mail link, since tickets need an account. */
export function GuestSupport() {
  useLocale();
  return (
    <Group title={t("Support")}>
      <Row label={t("Questions or problems? Write to us.")}>
        <ContactByEmail />
      </Row>
      {PRODUCT_IDENTITY.repositoryUrl ? (
        <Row label={t("GitHub")}>
          <ProjectLinks />
        </Row>
      ) : null}
    </Group>
  );
}

/** A support ticket written by the user. The draft survives every failure. */
export function AccountSupport() {
  useLocale();
  const [draft, setDraft] = useState<SupportDraft>(EMPTY_SUPPORT_DRAFT);
  const [result, setResult] = useState<SupportSubmitResult | null>(null);
  const [busy, setBusy] = useState(false);
  // Field errors follow the draft as it is now, and only while the last send was rejected.
  const issues = result?.status === "invalid" ? validateSupportDraft(draft) : [];
  const issue = (...names: SupportDraftIssue[]) => {
    const found = issues.find((name) => names.includes(name));
    return found ? issueText(found) : undefined;
  };
  // Any edit makes the last outcome stale, except a rejection of the fields: its errors follow
  // the draft through `issues`, so fixing one field leaves the other field's error in place.
  // A send still in flight sets `result` when it settles, so its outcome is shown even if the
  // user typed meanwhile.
  const edit = (next: SupportDraft) => {
    setDraft(next);
    setResult((current) => (current?.status === "invalid" ? current : null));
  };

  const send = async () => {
    setBusy(true);
    try {
      const next = await submitSupportTicket(accountApi(), draft, reportAccountFailure);
      setResult(next);
      if (next.status === "sent")
        setDraft((current) =>
          current.subject === draft.subject &&
          current.body === draft.body &&
          current.category === draft.category
            ? EMPTY_SUPPORT_DRAFT
            : current,
        );
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group
        title={t("Contact support")}
        action={
          <Button variant="primary" size="sm" loading={busy} onClick={send}>
            {t("Send to support")}
          </Button>
        }
        description={t(
          "Nothing from your sessions, code, logs or file paths is attached automatically. Do not paste passwords, tokens or other secrets.",
        )}
        feedback={
          result?.status === "sent" ? (
            <InlineMessage tone="success">
              {t("Your request was sent. Reference: {p0}", { p0: result.reference })}
            </InlineMessage>
          ) : result?.status === "rate-limited" ? (
            <InlineError>
              {t("Too many requests. Wait a little and try again; your message is kept.")}
            </InlineError>
          ) : result?.status === "failed" ? (
            <InlineError>{t("Could not send your request. Your message is kept.")}</InlineError>
          ) : undefined
        }
      >
        <Row label={t("Category")}>
          <Select
            label={t("Category")}
            hideLabel
            value={draft.category}
            options={SUPPORT_CATEGORIES.map((value) => ({ value, label: categoryLabel(value) }))}
            onValueChange={(value) => edit({ ...draft, category: value as SupportCategory })}
          />
        </Row>
        <Row label={t("Subject")} stacked>
          <TextField
            label={t("Subject")}
            hideLabel
            value={draft.subject}
            error={issue("subject-missing", "subject-long")}
            onChange={(event) => edit({ ...draft, subject: event.target.value })}
          />
        </Row>
        <Row label={t("Message")} stacked>
          <TextareaField
            label={t("Message")}
            hideLabel
            value={draft.body}
            minRows={5}
            maxRows={14}
            autosize
            error={issue("body-missing", "body-long")}
            onChange={(event) => edit({ ...draft, body: event.target.value })}
          />
        </Row>
      </Group>
      <Group title={null}>
        <Row label={t("Feedback")}>
          <Button variant="secondary" size="sm" onClick={openFeedbackDialog}>
            {t("Send feedback")}
          </Button>
        </Row>
        <Row label={t("E-mail")}>
          <ContactByEmail />
        </Row>
        {PRODUCT_IDENTITY.repositoryUrl ? (
          <Row label={t("GitHub")}>
            <ProjectLinks />
          </Row>
        ) : null}
      </Group>
    </>
  );
}
