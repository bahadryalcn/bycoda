import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useFormat, useT } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { Divider } from "../../../../../shared/ui/Divider";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import { socialQueryScope } from "../../../model/socialQuery";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";
import { TikTokPostSelect } from "./TikTokPostSelect";
import { TikTokRow, TikTokRows } from "./TikTokRows";
import "./tiktok.css";

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

/** Reviews the AI queues for the owner. Profile and privacy changes are edited in their own tabs. */
type ReviewChange = Omit<TikTokChange, "kind"> & {
  kind: TikTokChange["kind"] | "profile.update" | "privacy.update";
  patch?: Record<string, string | boolean>;
};

type Review = {
  id: string;
  change: ReviewChange;
  state: "pending" | "submitting" | "done" | "unknown";
  at: number;
};

export function TikTokChanges({
  client,
  accountId,
  accountName,
  disabled,
  active,
  draft,
  onDraftChange,
  businessConnected,
}: TikTokPanelProps & {
  accountName: string;
  /** The Changes tab is showing; the waiting reviews load once it is. */
  active: boolean;
  draft: TikTokChange;
  onDraftChange(value: TikTokChange): void;
  businessConnected: boolean;
}) {
  const t = useT();
  const format = useFormat();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState("");
  const {
    write,
    is,
    error,
    details: errorDetails,
  } = useAccountWrite(t("Could not complete the TikTok change."));
  const reviewsKey = [...socialQueryScope(client), "tiktok", accountId, "changes"];
  const query = useQuery({
    queryKey: reviewsKey,
    queryFn: () => client.request<Review[]>("tiktok.changes.list", { accountId }),
    enabled: active && !disabled,
    staleTime: 15_000,
  });
  const reviews = query.data;
  const setReviews = (update: (rows: Review[] | undefined) => Review[] | undefined) =>
    queryClient.setQueryData<Review[]>(reviewsKey, update);
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
  const reviewLabels: Record<ReviewChange["kind"], string> = {
    ...labels,
    "profile.update": t("Edit profile"),
    "privacy.update": t("Privacy"),
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
  const busy = query.isFetching || is("request") || !!pending;
  const handle = draft.recipientId?.replace(/^web:tiktok:/, "") ?? "";
  const canRequest =
    (!needsPost || /^\d{1,30}$/.test(draft.postId ?? "")) &&
    (!needsComment || /^[\w:.@-]{1,300}$/.test(draft.commentId ?? "")) &&
    (postChange || /^[a-z0-9_.]{2,24}$/.test(handle)) &&
    (!needsText || !!draft.text?.trim());

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
                  ? {
                      ...item,
                      state: result.status === "unknown" ? "unknown" : "done",
                    }
                  : item,
              ),
        );
    } finally {
      setPending("");
    }
  };
  const details = (change: ReviewChange) => (
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
      {Object.entries(change.patch ?? {}).map(([field, value]) => (
        <DescriptionItem key={field} term={field} monospace>
          {String(value)}
        </DescriptionItem>
      ))}
      {change.text && (
        <DescriptionItem term={change.kind === "post.edit" ? t("Caption") : t("Message")}>
          {change.text}
        </DescriptionItem>
      )}
    </DescriptionList>
  );
  const picked = needsComment && !!draft.commentId && !!draft.postId;
  const postField = (
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
  );
  const commentField = (
    <TextField
      label={t("TikTok comment ID")}
      value={draft.commentId ?? ""}
      disabled={disabled || busy}
      required
      maxLength={300}
      onChange={(event) => onDraftChange({ ...draft, commentId: event.currentTarget.value })}
    />
  );

  return (
    <div className="tiktok-panel">
      <div className="tiktok-head">
        <SectionLabel as="h3">{t("Waiting for review")}</SectionLabel>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || busy}
          loading={query.isFetching}
          onClick={() => {
            query.refetch().catch(() => undefined);
          }}
        >
          {t("Refresh")}
        </Button>
      </div>
      {query.isPending && query.fetchStatus !== "idle" && <LoadingText />}
      {query.isError && <InlineError>{t("Could not complete the TikTok change.")}</InlineError>}
      {reviews?.length === 0 && (
        <EmptyState context="list" size="inline" title={t("No pending changes")} />
      )}
      {reviews?.length ? (
        <TikTokRows>
          {reviews.map((review) => (
            <TikTokRow
              key={review.id}
              title={reviewLabels[review.change.kind]}
              meta={format.formatDate(review.at, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
              badge={
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
              }
              body={details(review.change)}
            >
              {review.state === "unknown" || review.state === "submitting" ? (
                <InlineMessage tone="warning">
                  {t(
                    "TikTok did not confirm this change. Check its current state before trying again.",
                  )}
                </InlineMessage>
              ) : null}
              {review.state === "pending" && (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || busy}
                  loading={pending === review.id}
                  onClick={() =>
                    confirm
                      .confirm({
                        title: reviewLabels[review.change.kind],
                        message: t("Review the exact changes before confirming."),
                        context: accountName,
                        details: details(review.change),
                        confirmLabel: reviewLabels[review.change.kind],
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
            </TikTokRow>
          ))}
        </TikTokRows>
      ) : null}
      <form
        className="tiktok-panel tiktok-section"
        aria-label={t("Queue a change")}
        onSubmit={(event) => {
          event.preventDefault();
          if (!disabled && !busy && canRequest) request().catch(() => undefined);
        }}
      >
        <Divider decorative />
        <SectionLabel as="h3">{t("Queue a change")}</SectionLabel>
        <div className="tiktok-grid">
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
                onDraftChange({
                  ...draft,
                  mediaType: value === "photo" ? "photo" : "video",
                })
              }
            />
          )}
        </div>
        {needsPost && businessConnected && (
          <TikTokPostSelect
            client={client}
            accountId={accountId}
            disabled={disabled || busy}
            value={draft.postId ?? ""}
            onChange={(postId) => onDraftChange({ ...draft, postId })}
          />
        )}
        {picked && (
          <>
            <InlineMessage tone="info">{t("Comment chosen from the Comments tab.")}</InlineMessage>
            {details({ ...draft, text: undefined })}
          </>
        )}
        {(needsPost || needsComment) && (
          <Disclosure
            key={`${draft.kind}:${picked}`}
            variant="plain"
            summary={t("Enter IDs instead")}
            defaultOpen={!picked && !businessConnected}
          >
            <div className="tiktok-grid">
              {needsPost && postField}
              {needsComment && commentField}
            </div>
          </Disclosure>
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
        {error && <InlineError details={errorDetails}>{error}</InlineError>}
        <div className="tiktok-actions">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={disabled || busy || !canRequest}
            loading={is("request")}
          >
            {t("Queue for review")}
          </Button>
        </div>
      </form>
      {confirm.dialog}
    </div>
  );
}
