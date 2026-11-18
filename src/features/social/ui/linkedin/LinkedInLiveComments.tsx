import { useState, type FormEvent } from "react";
import {
  LINKEDIN_LIVE_EVENT_ID,
  type LinkedInLiveCommentsPage,
} from "../../../../integrations/social/live-linkedin";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialClient } from "../../model/socialClient";
import type { LinkedInManagementReview } from "../../../../integrations/social/adapters/linkedin-manage";
import { useAccountWrite } from "../accounts/useAccountWrite";

export function LinkedInLiveComments({
  accountId,
  client,
  disabled,
  canReply,
}: {
  accountId: string;
  client: SocialClient;
  disabled: boolean;
  canReply: boolean;
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
      <form onSubmit={submit}>
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
          <Button
            type="submit"
            variant="secondary"
            size="sm"
            loading={is("comments")}
            disabled={!LINKEDIN_LIVE_EVENT_ID.test(eventId)}
          >
            {t("Load comments")}
          </Button>
        </FieldGroup>
      </form>
      {error ? <InlineError>{error}</InlineError> : null}
      {page?.comments.length ? (
        <ul>
          {page.comments.map((comment) => (
            <li key={comment.id}>
              <Text as="p" size="caption" tone="muted">
                {comment.actor}
              </Text>
              <Text as="p">{comment.text}</Text>
              {canReply && !replyTo ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled || busy}
                  onClick={() => {
                    setReplyTo(comment);
                    setSent(false);
                  }}
                >
                  {t("Reply")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : page ? (
        <Text as="p">{t("No results")}</Text>
      ) : null}
      {page?.nextOffset !== undefined ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled || busy || !!replyTo}
          onClick={() => void load(page.nextOffset).catch(() => undefined)}
        >
          {t("Next")}
        </Button>
      ) : null}
      {replyTo ? (
        <FieldGroup legend={t("Reply")} disabled={disabled || busy}>
          <Text as="p" size="secondary">
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
          <Button
            variant="secondary"
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
        </FieldGroup>
      ) : null}
      {sent ? <Text as="p">{t("Sent")}</Text> : null}
      {prepared?.state === "attempting" || prepared?.state === "inspect" ? (
        <InlineError>{t("Check the result on LinkedIn before trying again.")}</InlineError>
      ) : null}
      {dialog}
    </>
  );
}
