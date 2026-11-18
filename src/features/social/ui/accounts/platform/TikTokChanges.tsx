import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";

export type TikTokChange = {
  kind:
    | "follow"
    | "unfollow"
    | "comment.like"
    | "comment.hide"
    | "comment.delete"
    | "comment.pin"
    | "comment.reply"
    | "post.edit"
    | "post.delete"
    | "live.reply";
  postId?: string;
  commentId?: string;
  recipientId?: string;
  text?: string;
  mediaType?: "video" | "photo";
};

type Review = {
  id: string;
  change: TikTokChange;
  state: "pending" | "submitting" | "done" | "unknown";
  at: number;
};

export function TikTokChanges({
  client,
  accountId,
  accountName,
  disabled,
  draft,
  onDraftChange,
  businessConnected,
}: TikTokPanelProps & {
  accountName: string;
  draft: TikTokChange;
  onDraftChange(value: TikTokChange): void;
  businessConnected: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const confirm = useConfirm();
  const [reviews, setReviews] = useState<Review[]>();
  const [pending, setPending] = useState("");
  const { write, is, error } = useAccountWrite(t("Could not complete the TikTok change."));
  const labels: Record<TikTokChange["kind"], string> = {
    follow: t("Follow"),
    unfollow: t("Unfollow"),
    "comment.like": t("Like comment"),
    "comment.hide": t("Hide comment"),
    "comment.delete": t("Delete comment"),
    "comment.pin": t("Pin comment"),
    "comment.reply": t("Reply to comment"),
    "post.edit": t("Edit caption"),
    "post.delete": t("Delete post"),
    "live.reply": t("Reply to LIVE comment"),
  };
  const status = {
    pending: t("Awaiting approval"),
    submitting: t("Check TikTok"),
    done: t("Completed"),
    unknown: t("Check TikTok"),
  };
  const postChange = draft.kind.startsWith("post.");
  const commentChange = draft.kind.startsWith("comment.");
  const needsPost = postChange || commentChange;
  const needsComment = commentChange || draft.kind === "live.reply";
  const needsText =
    draft.kind === "post.edit" || draft.kind === "live.reply" || draft.kind === "comment.reply";
  const busy = is("list") || is("request") || !!pending;
  const handle = draft.recipientId?.replace(/^web:tiktok:/, "") ?? "";
  const canRequest =
    (!needsPost || /^\d{1,30}$/.test(draft.postId ?? "")) &&
    (!needsComment || /^[\w:.@-]{1,300}$/.test(draft.commentId ?? "")) &&
    (postChange || /^[a-z0-9_.]{2,24}$/.test(handle)) &&
    (!needsText || !!draft.text?.trim());

  const refresh = () => client.request<Review[]>("tiktok.changes.list", { accountId });
  const list = async () => {
    const rows = await write("list", refresh);
    if (rows) setReviews(rows);
  };
  const request = async () => {
    const row = await write("request", () =>
      client.request<Review>("tiktok.changes.request", { accountId, ...draft }),
    );
    if (row)
      setReviews((current) => [row, ...(current ?? []).filter((item) => item.id !== row.id)]);
  };
  const apply = async (review: Review, action: "apply" | "dismiss") => {
    setPending(review.id);
    try {
      const result = await write("apply", () =>
        client.request<{ status?: "unknown" }>(
          action === "apply" ? "tiktok.changes.apply" : "tiktok.changes.dismiss",
          { accountId, reviewId: review.id, confirm: true },
        ),
      );
      if (result)
        setReviews((rows) =>
          action === "dismiss"
            ? rows?.filter((item) => item.id !== review.id)
            : rows?.map((item) =>
                item.id === review.id
                  ? { ...item, state: result.status === "unknown" ? "unknown" : "done" }
                  : item,
              ),
        );
    } finally {
      setPending("");
    }
  };
  const details = (change: TikTokChange) => (
    <DescriptionList size="sm">
      {change.recipientId && (
        <DescriptionItem term={t("Username")}>
          @{change.recipientId.replace(/^web:tiktok:/, "")}
        </DescriptionItem>
      )}
      {change.postId && (
        <DescriptionItem term={t("TikTok post ID")} monospace>
          {change.postId}
        </DescriptionItem>
      )}
      {change.commentId && (
        <DescriptionItem term={t("TikTok comment ID")} monospace>
          {change.commentId}
        </DescriptionItem>
      )}
      {change.mediaType && (
        <DescriptionItem term={t("Format")}>
          {change.mediaType === "photo" ? t("Photo") : t("Video")}
        </DescriptionItem>
      )}
      {change.text && (
        <DescriptionItem term={change.kind === "post.edit" ? t("Caption") : t("Message")}>
          {change.text}
        </DescriptionItem>
      )}
    </DescriptionList>
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <form
        className="flex min-w-0 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !busy && canRequest) request().catch(() => undefined);
        }}
      >
        <Select
          label={t("Action")}
          value={draft.kind}
          disabled={disabled || busy}
          options={Object.entries(labels)
            .filter(([value]) => businessConnected || value !== "comment.reply")
            .map(([value, label]) => ({ value, label }))}
          onValueChange={(value) => {
            const kind = (Object.keys(labels) as TikTokChange["kind"][]).find(
              (key) => key === value,
            );
            if (kind) {
              const nextPost = kind.startsWith("post.");
              const nextComment = kind.startsWith("comment.");
              onDraftChange({
                kind,
                ...(nextPost || nextComment ? { postId: draft.postId } : {}),
                ...(!nextPost ? { recipientId: draft.recipientId } : {}),
                ...(nextComment && commentChange ? { commentId: draft.commentId } : {}),
                ...(nextPost && postChange ? { mediaType: draft.mediaType } : {}),
              });
            }
          }}
        />
        {!postChange && (
          <TextField
            label={t("Username")}
            value={handle}
            disabled={disabled || busy}
            required
            maxLength={24}
            pattern="[a-z0-9_.]{2,24}"
            onChange={(event) => {
              const username = event.currentTarget.value.toLowerCase();
              onDraftChange({
                ...draft,
                recipientId: username ? `web:tiktok:${username}` : undefined,
              });
            }}
          />
        )}
        {needsPost && (
          <TextField
            label={t("TikTok post ID")}
            value={draft.postId ?? ""}
            disabled={disabled || busy}
            required
            inputMode="numeric"
            pattern="[0-9]{1,30}"
            maxLength={30}
            onChange={(event) => onDraftChange({ ...draft, postId: event.currentTarget.value })}
          />
        )}
        {needsComment && (
          <TextField
            label={t("TikTok comment ID")}
            value={draft.commentId ?? ""}
            disabled={disabled || busy}
            required
            maxLength={300}
            onChange={(event) => onDraftChange({ ...draft, commentId: event.currentTarget.value })}
          />
        )}
        {postChange && (
          <Select
            label={t("Format")}
            value={draft.mediaType ?? "video"}
            disabled={disabled || busy}
            options={[
              { value: "video", label: t("Video") },
              { value: "photo", label: t("Photo") },
            ]}
            onValueChange={(value) =>
              onDraftChange({ ...draft, mediaType: value === "photo" ? "photo" : "video" })
            }
          />
        )}
        {needsText && (
          <TextareaField
            label={draft.kind === "post.edit" ? t("Caption") : t("Message")}
            value={draft.text ?? ""}
            disabled={disabled || busy}
            rows={3}
            required
            maxLength={draft.kind === "post.edit" ? 2200 : 150}
            onChange={(event) => onDraftChange({ ...draft, text: event.currentTarget.value })}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={disabled || busy || !canRequest}
            loading={is("request")}
          >
            {t("Queue for review")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || busy}
            loading={is("list")}
            onClick={() => list().catch(() => undefined)}
          >
            {t("Load TikTok reviews")}
          </Button>
        </div>
      </form>
      {reviews?.length === 0 && (
        <EmptyState context="list" size="inline" title={t("No pending changes")} />
      )}
      {reviews?.map((review) => (
        <div key={review.id} className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Text weight="medium">{labels[review.change.kind]}</Text>
            <Badge
              size="sm"
              tone={
                review.state === "done"
                  ? "success"
                  : review.state === "pending"
                    ? "neutral"
                    : "warning"
              }
            >
              {status[review.state]}
            </Badge>
            <Text tone="secondary" size="caption">
              {format.formatDate(review.at, { dateStyle: "medium", timeStyle: "short" })}
            </Text>
          </div>
          {details(review.change)}
          {review.state === "unknown" || review.state === "submitting" ? (
            <InlineMessage tone="warning">
              {t(
                "TikTok did not confirm this change. Check its current state before trying again.",
              )}
            </InlineMessage>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {review.state === "pending" && (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled || busy}
                loading={pending === review.id}
                onClick={() =>
                  confirm
                    .confirm({
                      title: labels[review.change.kind],
                      message: t("Review the exact changes before confirming."),
                      context: accountName,
                      details: details(review.change),
                      confirmLabel: labels[review.change.kind],
                      danger: review.change.kind.endsWith(".delete"),
                      onConfirm: () => apply(review, "apply"),
                    })
                    .catch(() => undefined)
                }
              >
                {t("Review and apply")}
              </Button>
            )}
            {review.state !== "done" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || busy}
                onClick={() =>
                  confirm
                    .confirm({
                      title: t("Dismiss TikTok review"),
                      message: t("Dismiss this review after checking the change in TikTok."),
                      context: accountName,
                      details: details(review.change),
                      confirmLabel: t("Dismiss"),
                      danger: false,
                      onConfirm: () => apply(review, "dismiss"),
                    })
                    .catch(() => undefined)
                }
              >
                {t("Dismiss")}
              </Button>
            )}
          </div>
        </div>
      ))}
      {error && <InlineError>{error}</InlineError>}
      {confirm.dialog}
    </div>
  );
}
