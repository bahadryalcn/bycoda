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

type Page = { requests: InstagramModerationRequest[]; next?: string };

export function InstagramModerationReviews({
  client,
  threadId,
}: {
  client: SocialClient;
  threadId: string;
}) {
  const [page, setPage] = useState<Page>();
  const confirmation = useConfirm();
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
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
  const decide = (request: InstagramModerationRequest, decision: "approve" | "dismiss") => {
    const approved =
      decision === "approve"
        ? confirmation.confirm({
            title: actionLabel(request.action),
            message: request.commentText,
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
                  requests: current.requests.map((item) => (item.id === result.id ? result : item)),
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
              <Text as="p" tone="secondary">
                {request.commentText}
              </Text>
              {request.status === "pending" ? (
                <div className="social-tag-line">
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={is(request.id)}
                    onClick={() => decide(request, "approve")}
                  >
                    {t("Approve")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={is(request.id)}
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
        <Button variant="ghost" size="sm" disabled={is("read")} onClick={() => read(page.next)}>
          {t("Load more")}
        </Button>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
