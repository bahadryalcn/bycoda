import { useState, type FormEvent } from "react";
import {
  LINKEDIN_LIVE_EVENT_ID,
  type LinkedInLiveCommentsPage,
} from "../../../../integrations/social/live-linkedin";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Surface } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialClient } from "../../model/socialClient";
import type { LinkedInManagementReview } from "../../../../integrations/social/adapters/linkedin-manage";
import { useAccountWrite } from "../accounts/useAccountWrite";
import "./linkedin.css";

export function LinkedInLiveComments({
  accountId,
  client,
  disabled,
  canReply,
  storedEventId,
}: {
  accountId: string;
  client: SocialClient;
  disabled: boolean;
  canReply: boolean;
  /** The event whose stream credentials are saved, offered as a one-tap choice. */
  storedEventId?: string;
}) {
  const [eventId, setEventId] = useState("");
  const [page, setPage] = useState<LinkedInLiveCommentsPage>();
  const [offset, setOffset] = useState(0);
  const [replyTo, setReplyTo] = useState<LinkedInLiveCommentsPage["comments"][number]>();
  const [text, setText] = useState("");
  const [prepared, setPrepared] = useState<LinkedInManagementReview>();
  const [sent, setSent] = useState(false);
  const { confirm, dialog } = useConfirm();
  const { error, is, write } = useAccountWrite(t("Could not load LinkedIn Live comments."));
  const busy = is("comments") || is("prepare") || is("reply");
  const load = (offset = 0) =>
    write("comments", async () => {
      setPage(
        await client.request<LinkedInLiveCommentsPage>("linkedin.live.comments.read", {
          accountId,
          eventId,
          offset,
        }),
      );
      setOffset(offset);
      setSent(false);
    });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!disabled && !busy && LINKEDIN_LIVE_EVENT_ID.test(eventId))
      void load().catch(() => undefined);
  };
  const reviewReply = async () => {
    if (!replyTo || !page || !canReply || !text.trim() || busy || disabled) return;
    const review =
      prepared ??
      (await write("prepare", () =>
        client.request<LinkedInManagementReview>("linkedin.live.comments.prepareReply", {
          accountId,
          eventId: page.eventId,
          offset,
          commentId: replyTo.id,
          expectedComment: replyTo.text,
          text,
        }),
      ));
    if (review?.action.kind !== "replyLive") return;
    setPrepared(review);
    if (review.state !== "review") return;
    await confirm({
      title: t("Reply"),
      message: [replyTo.actor, replyTo.text, review.action.text].join("\n\n"),
      confirmLabel: t("Send"),
      onConfirm: async () => {
        const result = await write("reply", async () => {
          try {
            return await client.request<LinkedInManagementReview>("linkedin.management.submit", {
              accountId,
              id: review.id,
              reviewed: review,
            });
          } catch (error) {
            const current = await client
              .request<LinkedInManagementReview>("linkedin.management.get", {
                accountId,
                id: review.id,
              })
              .catch(() => undefined);
            if (current && current.state !== "review") return current;
            throw error;
          }
        });
        if (result) setPrepared(result);
        if (result?.state === "succeeded") {
          setReplyTo(undefined);
          setText("");
          setPrepared(undefined);
          setSent(true);
        }
      },
    });
  };
  return (
    <>
      <form onSubmit={submit} className="social-li-group">
        <FieldGroup legend={t("LinkedIn Live comments")} disabled={disabled || busy || !!replyTo}>
          <TextField
            label={t("LinkedIn event ID")}
            inputMode="numeric"
            required
            maxLength={25}
            value={eventId}
            onChange={(event) => {
              setEventId(event.target.value.trim());
              setPage(undefined);
            }}
          />
          {storedEventId && storedEventId !== eventId ? (
            <Button
              variant="link"
              size="sm"
              className="self-start"
              onClick={() => {
                setEventId(storedEventId);
                setPage(undefined);
              }}
            >
              {t("Use the event with saved credentials")}
            </Button>
          ) : null}
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            className="self-start"
            loading={is("comments")}
            disabled={!LINKEDIN_LIVE_EVENT_ID.test(eventId)}
          >
            {t("Load comments")}
          </Button>
        </FieldGroup>
      </form>
      {error ? <InlineError>{error}</InlineError> : null}
      {page?.comments.length ? (
        <ul className="social-li-list">
          {page.comments.map((comment) => (
            <Surface
              key={comment.id}
              as="li"
              variant="card"
              padding="sm"
              className="social-li-item"
            >
              <Text as="span" size="caption" tone="muted">
                {comment.actor}
              </Text>
              <Text as="p" className="social-li-text">
                {comment.text}
              </Text>
              {canReply && !replyTo ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="self-start"
                  disabled={disabled || busy}
                  onClick={() => {
                    setReplyTo(comment);
                    setSent(false);
                  }}
                >
                  {t("Reply")}
                </Button>
              ) : null}
            </Surface>
          ))}
        </ul>
      ) : page ? (
        <EmptyState size="inline" description={t("No comments on this event yet.")} />
      ) : null}
      {page?.nextOffset !== undefined ? (
        <Button
          variant="secondary"
          size="sm"
          className="self-start"
          disabled={disabled || busy || !!replyTo}
          onClick={() => void load(page.nextOffset).catch(() => undefined)}
        >
          {t("Next")}
        </Button>
      ) : null}
      {replyTo ? (
        <FieldGroup legend={t("Reply")} disabled={disabled || busy}>
          <Text as="p" size="secondary" tone="muted" className="social-li-text">
            {replyTo.text}
          </Text>
          <TextareaField
            label={t("Reply")}
            value={text}
            maxLength={3000}
            onChange={(event) => {
              setText(event.target.value);
              setPrepared(undefined);
            }}
          />
          <div className="social-li-actions">
            <Button
              variant="primary"
              size="sm"
              disabled={!text.trim() || (prepared !== undefined && prepared.state !== "review")}
              onClick={() => void reviewReply().catch(() => undefined)}
            >
              {t("Review change")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setReplyTo(undefined);
                setText("");
                setPrepared(undefined);
              }}
            >
              {t("Cancel")}
            </Button>
          </div>
        </FieldGroup>
      ) : null}
      {sent ? <InlineMessage tone="success">{t("Sent")}</InlineMessage> : null}
      {prepared?.state === "attempting" || prepared?.state === "inspect" ? (
        <InlineError>{t("Check the result on LinkedIn before trying again.")}</InlineError>
      ) : null}
      {dialog}
    </>
  );
}
