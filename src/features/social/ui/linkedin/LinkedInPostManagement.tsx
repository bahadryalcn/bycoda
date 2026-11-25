import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Surface } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { LinkedInManagementReview } from "../../../../integrations/social/adapters/linkedin-manage";
import type { SocialAccount, SocialJob } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";
import "./linkedin.css";
import { linkedInBusyReason } from "./linkedinReasons";

export function LinkedInPostManagement({
  account,
  client,
  disabled,
}: {
  account: SocialAccount;
  client: SocialClient;
  disabled: boolean;
}) {
  const [jobs, setJobs] = useState<SocialJob[]>([]);
  const [jobId, setJobId] = useState("");
  const [text, setText] = useState("");
  const [reviewId, setReviewId] = useState("");
  const [review, setReview] = useState<LinkedInManagementReview>();
  const confirm = useConfirm();
  const { failureTitle, details, is, write } = useAccountWrite(t("Could not save changes."));
  const [jobsLoaded, setJobsLoaded] = useState(false);
  const busy = is("review") || is("submit") || is("posts");
  const reviewLabels = {
    editPost: t("Edit post"),
    deletePost: t("Delete post"),
    deleteComment: t("Delete comment"),
    replyLive: t("Reply"),
    react: t("Add reaction"),
    removeReaction: t("Remove reaction"),
  };
  const reviewStates: Record<string, string> = {
    review: t("Needs review"),
    attempting: t("Unconfirmed"),
    inspect: t("Needs review"),
    succeeded: t("Completed"),
  };
  const posts = jobs.filter(
    (job) =>
      job.accountId === account.id &&
      job.kind === "publish" &&
      job.status === "succeeded" &&
      job.platformId,
  );
  const job = posts.find((item) => item.id === jobId);
  const accountId = account.id;
  const loadPosts = () =>
    write("posts", async () => {
      const page = await client.workspaceSnapshot({
        section: "history",
        limit: 50,
        filters: { jobs: { accountId, kind: "publish", status: "succeeded" } },
      });
      setJobs(page.snapshot?.jobs ?? []);
      setJobsLoaded(true);
    });
  const load = (kind?: "editPost" | "deletePost") =>
    write("review", async () => {
      const next = kind
        ? await client.request<LinkedInManagementReview>("linkedin.management.prepare", {
            accountId,
            jobId,
            kind,
            ...(kind === "editPost" ? { text } : {}),
          })
        : await client.request<LinkedInManagementReview>("linkedin.management.get", {
            id: reviewId.trim(),
            accountId,
          });
      setReview(next);
      setReviewId(next.id);
    });
  const submit = async () => {
    if (!review || review.state !== "review" || review.expiresAt <= Date.now()) return;
    const action = review.action;
    await confirm.confirm({
      title: reviewLabels[action.kind],
      message: [
        account.name,
        "postId" in action ? action.postId : action.entityId,
        action.kind === "deleteComment" || action.kind === "replyLive" ? action.commentId : null,
        action.kind === "editPost" || action.kind === "replyLive"
          ? action.text
          : action.kind === "react"
            ? action.reaction
            : null,
      ]
        .filter(Boolean)
        .join("\n"),
      confirmLabel: t("Confirm"),
      danger: action.kind === "deletePost" || action.kind === "deleteComment",
      onConfirm: async () => {
        await write("submit", async () => {
          setReview(
            await client.request<LinkedInManagementReview>("linkedin.management.submit", {
              id: review.id,
              accountId,
              reviewed: review,
            }),
          );
        });
      },
    });
  };
  return (
    <Disclosure summary={t("Manage LinkedIn posts")} variant="row">
      <div className="social-li-stack">
        <FieldGroup variant="bare" disabled={disabled || busy}>
          <div className="social-li-toolbar">
            <Button
              variant="secondary"
              size="sm"
              loading={is("posts")}
              onClick={() => void loadPosts().catch(() => undefined)}
            >
              {t("Refresh")}
            </Button>
            {!jobsLoaded && !is("posts") ? (
              <Text as="span" size="caption" tone="muted">
                {t("Load the posts you published from MonoCode to edit or delete them.")}
              </Text>
            ) : null}
          </div>
          {jobsLoaded && !posts.length ? (
            <EmptyState size="inline" description={t("No published LinkedIn posts yet.")} />
          ) : null}
          {posts.length ? (
            <>
              <Select
                label={t("Post")}
                value={jobId}
                options={[
                  { value: "", label: t("Choose a post") },
                  ...posts.map((item) => ({
                    value: item.id,
                    label: item.payload.text.trim().slice(0, 100) || item.platformId!,
                  })),
                ]}
                onValueChange={(value) => {
                  setJobId(value);
                  setReview(undefined);
                  const payload = posts.find((item) => item.id === value)?.payload;
                  setText([payload?.text, payload?.link].filter(Boolean).join("\n"));
                }}
              />
              {job ? (
                <>
                  <TextareaField
                    label={t("Post text")}
                    value={text}
                    maxLength={3000}
                    onChange={(event) => setText(event.target.value)}
                  />
                  <div className="social-li-actions">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={!text.trim()}
                      onClick={() => void load("editPost").catch(() => undefined)}
                    >
                      {t("Edit post")}
                    </Button>
                    <Button
                      variant="ghost"
                      tone="danger"
                      size="sm"
                      onClick={() => void load("deletePost").catch(() => undefined)}
                    >
                      {t("Delete post")}
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </FieldGroup>
        {review ? (
          <Surface variant="card" padding="sm" className="social-li-item">
            <div className="social-li-item-head">
              <Text as="span" weight="medium">
                {reviewLabels[review.action.kind]}
              </Text>
              <Badge tone={review.state === "succeeded" ? "success" : "neutral"}>
                {reviewStates[review.state] ?? review.state}
              </Badge>
            </div>
            {review.action.kind === "editPost" ? (
              <Text as="p" size="secondary" tone="muted" className="social-li-text">
                {review.action.text}
              </Text>
            ) : null}
            {review.state === "review" ? (
              <Button
                variant="primary"
                size="sm"
                className="self-start"
                disabled={disabled || busy}
                disabledReason={linkedInBusyReason(disabled)}
                loading={is("submit")}
                onClick={() => void submit().catch(() => undefined)}
              >
                {t("Review change")}
              </Button>
            ) : null}
          </Surface>
        ) : null}
        <Disclosure summary={t("Open an existing review")} variant="row">
          <FieldGroup variant="bare" disabled={disabled || busy}>
            <TextField
              label={t("LinkedIn review ID")}
              value={reviewId}
              onChange={(event) => {
                setReviewId(event.target.value);
                setReview(undefined);
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              disabled={!reviewId.trim()}
              loading={is("review")}
              onClick={() => void load().catch(() => undefined)}
            >
              {t("Load review")}
            </Button>
          </FieldGroup>
        </Disclosure>
        {review?.state === "succeeded" ? (
          <InlineMessage tone="success">{t("Saved")}</InlineMessage>
        ) : null}
        {review?.state === "attempting" || review?.state === "inspect" ? (
          <InlineError>{t("Check the result on LinkedIn before trying again.")}</InlineError>
        ) : null}
        {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      </div>
      {confirm.dialog}
    </Disclosure>
  );
}
