import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import type {
  InstagramModerationAction,
  InstagramModerationRequest,
  InstagramModerationReview,
} from "../../model/instagramModeration";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

const actionLabel = (action: InstagramModerationAction) => {
  switch (action) {
    case "hide":
      return t("Hide Instagram comment");
    case "unhide":
      return t("Unhide Instagram comment");
    case "delete":
      return t("Delete Instagram comment");
  }
};

type Page = { requests: InstagramModerationReview[]; next?: string };

export function InstagramModerationReviews({
  client,
  threadId,
}: {
  client: SocialClient;
  threadId: string;
}) {
  const [page, setPage] = useState<Page>();
  const confirmation = useConfirm();
  const { write, is, failureTitle, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const load = async (before?: string) => {
    const current = await client.request<Page>("instagram.comments.requests.list", {
      threadId,
      ...(before ? { before } : {}),
    });
    setPage((previous) =>
      before && previous
        ? { ...current, requests: [...previous.requests, ...current.requests] }
        : current,
    );
  };
  const read = (before?: string) => {
    void write("read", () => load(before)).catch(() => undefined);
  };
  const decide = (review: InstagramModerationReview, decision: "approve" | "dismiss") => {
    const { commentText, ...request } = review;
    if (decision === "approve" && commentText === undefined) return;
    const approved =
      decision === "approve"
        ? confirmation.confirm({
            title: actionLabel(request.action),
            message: commentText,
            confirmLabel: t("Approve"),
            danger: request.action === "delete",
          })
        : Promise.resolve(true);
    void approved
      .then((ok) => {
        if (!ok) return;
        return write(request.id, async () => {
          const result = await client.request<InstagramModerationRequest>(
            "instagram.comments.requests.decide",
            {
              id: request.id,
              reviewed: request,
              decision,
            },
          );
          if (result.status === "uncertain") {
            setPage(
              (current) =>
                current && {
                  ...current,
                  requests: current.requests.map((item) =>
                    item.id === result.id ? { ...item, status: result.status } : item,
                  ),
                },
            );
          }
          await load();
        });
      })
      .catch(() => undefined);
  };
  return (
    <FieldGroup legend={t("Instagram moderation requests")}>
      <Button variant="secondary" size="sm" loading={is("read")} onClick={() => read()}>
        {t("Review Instagram moderation requests")}
      </Button>
      {page?.requests.length === 0 ? (
        <Text size="caption" tone="muted">
          {t("No Instagram moderation requests.")}
        </Text>
      ) : null}
      {page?.requests.length ? (
        <ul>
          {page.requests.map((request) => (
            <li key={request.id}>
              <Text as="p">{actionLabel(request.action)}</Text>
              {request.commentText !== undefined ? (
                <Text as="p" tone="secondary">
                  {request.commentText}
                </Text>
              ) : null}
              {request.status === "pending" ? (
                <div className="social-tag-line">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={is(request.id)}
                    disabled={request.commentText === undefined}
                    disabledReason={t("The comment is unavailable, so it cannot be approved.")}
                    onClick={() => decide(request, "approve")}
                  >
                    {t("Approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={is(request.id)}
                    disabledReason={t("Wait for the current action to finish.")}
                    onClick={() => decide(request, "dismiss")}
                  >
                    {t("Dismiss")}
                  </Button>
                </div>
              ) : (
                <InlineMessage tone="warning">
                  {request.status === "attempting"
                    ? t("Instagram moderation is awaiting a result.")
                    : t(
                        "Instagram moderation outcome is uncertain. Check the comment in Instagram.",
                      )}
                </InlineMessage>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {page?.next ? (
        <Button variant="ghost" size="sm" loading={is("read")} onClick={() => read(page.next)}>
          {t("Load more")}
        </Button>
      ) : null}
      {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
