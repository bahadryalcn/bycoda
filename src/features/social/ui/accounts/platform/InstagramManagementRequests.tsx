import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { openExternal } from "../../../../../platform/tauri/openExternal";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import {
  instagramManagementApply,
  type InstagramManagementKind,
  type InstagramManagementRequest,
} from "../../../model/instagramManagement";
import type { SocialClient } from "../../../model/socialClient";
import { socialQueryScope } from "../../../model/socialQuery";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

/**
 * Changes the assistant proposes for this Instagram account. Nothing runs until the owner chooses
 * "Review and apply" and confirms; the change then goes through the same owner-only browser call as
 * the matching tab and the request is removed. A message opens the New message form prefilled. A
 * failed apply is never retried from here: the owner checks Instagram first and dismisses it.
 */
export function InstagramManagementRequests({
  client,
  accountId,
  disabled,
  onReviewMessage,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
  onReviewMessage: (input: { handle: string; text: string }) => boolean;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const confirmation = useConfirm();
  const [uncertain, setUncertain] = useState<ReadonlySet<string>>(new Set());
  const { write, is, error } = useAccountWrite(t("Could not save this change. Try again."));
  const scope = [...socialQueryScope(client), "instagram", accountId];
  const requestsKey = [...scope, "management"];
  const query = useQuery({
    queryKey: requestsKey,
    queryFn: async () =>
      (
        await client.request<{ requests: InstagramManagementRequest[] }>(
          "instagram.management.list",
          { accountId },
        )
      ).requests,
    staleTime: 15_000,
  });
  const requests = query.data;
  const titles: Record<InstagramManagementKind, string> = {
    "post.edit": t("Edit post"),
    "post.delete": t("Delete post"),
    "profile.update": t("Edit profile"),
    "highlight.create": t("Create Highlight"),
    "highlight.edit": t("Edit Highlight"),
    "highlight.delete": t("Delete Highlight"),
    "dm.draft": t("New message"),
  };
  const remove = (item: InstagramManagementRequest) =>
    queryClient.setQueryData<InstagramManagementRequest[]>(requestsKey, (current) =>
      current?.filter((row) => row.id !== item.id),
    );
  const dismiss = async (item: InstagramManagementRequest) => {
    const done = await write(item.id, () =>
      client.request("instagram.management.dismiss", {
        accountId,
        id: item.id,
      }),
    );
    if (done) remove(item);
  };
  const apply = async (item: InstagramManagementRequest) => {
    const action = instagramManagementApply(item);
    if (!action) return;
    if (action.type === "message") {
      onReviewMessage({ handle: action.handle, text: action.text });
      return;
    }
    const ok = await confirmation.confirm({
      title: titles[item.kind],
      message: t("Apply this change on Instagram?"),
      details: (
        <DescriptionList size="sm">
          {Object.entries(item.details).map(([field, value]) => (
            <DescriptionItem
              key={field}
              term={field === "postUrl" ? t("Instagram post URL") : field}
              monospace
            >
              {typeof value === "string" ? value : JSON.stringify(value)}
            </DescriptionItem>
          ))}
        </DescriptionList>
      ),
      confirmLabel: t("Apply"),
      danger: item.kind === "post.delete" || item.kind === "highlight.delete",
    });
    if (!ok) return;
    const applied = await write(item.id, async () => {
      try {
        if (action.type === "post") {
          const result = await client.browserInstagramPost(accountId, action.change);
          if (result.deletion) {
            await queryClient.invalidateQueries({
              queryKey: [...scope, "post-deletion"],
            });
            if (result.deletion === "review") {
              setUncertain((current) => new Set(current).add(item.id));
              await queryClient.invalidateQueries({ queryKey: requestsKey });
              return false;
            }
          }
        } else if (action.type === "highlight")
          await client.browserInstagramHighlightChange(accountId, action.change);
        else await client.browserProfileUpdate(accountId, "instagram", action.patch);
      } catch (cause) {
        // The change may have reached Instagram: never offer it again from this list.
        setUncertain((current) => new Set(current).add(item.id));
        throw cause;
      }
      return true;
    });
    if (applied) await dismiss(item);
  };
  return (
    <section className="instagram-panel" aria-label={t("Instagram requests")}>
      <div className="instagram-actions">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled}
          loading={query.isFetching}
          onClick={() => {
            query.refetch().catch(() => undefined);
          }}
        >
          {t("Refresh")}
        </Button>
        <Text as="span" size="caption" tone="muted">
          {t("Changes the assistant proposes wait here for your approval.")}
        </Text>
      </div>
      {!requests && query.isFetching ? <LoadingText /> : null}
      {requests?.length === 0 ? (
        <EmptyState size="inline" description={t("No requests waiting.")} />
      ) : null}
      {requests?.map((item) => (
        <Surface key={item.id} variant="card" padding="sm" className="instagram-request">
          <Text as="p" weight="medium">
            {titles[item.kind]}
          </Text>
          <DescriptionList size="sm">
            {Object.entries(item.details).map(([field, value]) => (
              <DescriptionItem
                key={field}
                term={field === "postUrl" ? t("Instagram post URL") : field}
                monospace
              >
                {typeof value === "string" ? value : JSON.stringify(value)}
              </DescriptionItem>
            ))}
          </DescriptionList>
          {item.deletion === "deleted" ? (
            <InlineMessage tone="success">{t("Deleted")}</InlineMessage>
          ) : item.deletion === "review" || uncertain.has(item.id) ? (
            <InlineMessage tone="warning">
              {t("This change may already be on Instagram. Check Instagram, then dismiss it.")}
            </InlineMessage>
          ) : null}
          <div className="instagram-actions">
            {item.deletion === "review" && typeof item.details.postUrl === "string" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const url = item.details.postUrl;
                  if (typeof url === "string")
                    void write(`open:${item.id}`, () => openExternal(url)).catch(() => undefined);
                }}
              >
                {t("Open post")}
              </Button>
            ) : null}
            {item.deletion || uncertain.has(item.id) ? null : (
              <Button
                size="sm"
                variant="primary"
                disabled={disabled || !instagramManagementApply(item)}
                loading={is(item.id)}
                onClick={() => {
                  apply(item).catch(() => undefined);
                }}
              >
                {item.kind === "dm.draft" ? t("Review in Messages") : t("Review and apply")}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              loading={is(item.id)}
              onClick={() => {
                dismiss(item).catch(() => undefined);
              }}
            >
              {t("Dismiss")}
            </Button>
          </div>
        </Surface>
      ))}
      {error || query.error ? (
        <InlineError>{error || t("Could not load data.")}</InlineError>
      ) : null}
      {confirmation.dialog}
    </section>
  );
}
