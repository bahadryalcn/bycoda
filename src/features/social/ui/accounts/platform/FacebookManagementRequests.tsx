import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Surface } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import {
  facebookManagementAutonomy,
  type FacebookManagementRequest,
} from "../../../model/facebookManagement";
import type { AutonomyLevel, AutonomyAction } from "../../../model/autonomy";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./facebook.css";

export function FacebookManagementRequests({
  client,
  accountId,
}: {
  client: SocialClient;
  accountId: string;
}) {
  const t = useT();
  const confirm = useConfirm();
  const [items, setItems] = useState<FacebookManagementRequest[]>();
  const [levels, setLevels] = useState<Partial<Record<AutonomyAction, AutonomyLevel>>>({});
  const work = useAccountWrite(t("Could not save this change. Try again."));
  const titles = {
    "facebook.page.update": t("Edit profile"),
    "facebook.post.edit": t("Edit post"),
    "facebook.post.delete": t("Delete post"),
    "facebook.comment.moderate": t("Comment moderation"),
    "facebook.live.create": t("Create live video"),
    "facebook.live.start": t("Go live"),
    "facebook.live.end": t("End live video"),
  };
  const labels = {
    pending: t("Pending"),
    approved: t("Approved"),
    submitted: t("Submitted"),
    completed: t("Completed"),
    review: t("Needs review"),
  };
  const fields: Record<string, string> = {
    about: t("About"),
    description: t("Description"),
    website: t("Website"),
    phone: t("Phone"),
    emails: t("Email"),
    hours: t("Hours"),
    avatarPhotoId: t("Profile photo ID"),
    coverPhotoId: t("Cover photo ID"),
    postId: t("Post"),
    threadId: t("Comments"),
    action: t("Action"),
    title: t("Title"),
    text: t("Text"),
    liveId: t("Live video"),
  };
  const actions: Record<string, string> = {
    hide: t("Hide comment"),
    unhide: t("Unhide comment"),
    delete: t("Delete comment"),
    like: t("Like comment"),
    unlike: t("Unlike comment"),
  };
  const details = (item: FacebookManagementRequest) => {
    const patch = item.details.patch;
    return Object.entries(patch && typeof patch === "object" ? patch : item.details).map(
      ([field, value]) => (
        <Text key={field} as="p" className="social-card-description">
          {fields[field] ?? field} ·{" "}
          {field === "action"
            ? actions[String(value)]
            : typeof value === "string"
              ? value
              : JSON.stringify(value)}
        </Text>
      ),
    );
  };
  const detailList = (item: FacebookManagementRequest) => {
    const patch = item.details.patch;
    const entries = Object.entries(patch && typeof patch === "object" ? patch : item.details);
    return entries.length ? (
      <DescriptionList size="sm">
        {entries.map(([field, value]) => (
          <DescriptionItem key={field} term={fields[field] ?? field}>
            {field === "action"
              ? actions[String(value)]
              : typeof value === "string"
                ? value
                : JSON.stringify(value)}
          </DescriptionItem>
        ))}
      </DescriptionList>
    ) : null;
  };
  const load = async () => {
    const result = await work.write("list", () =>
      Promise.all([
        client.request<{ requests: FacebookManagementRequest[] }>("facebook.management.list", {
          accountId,
        }),
        client.request<{ levels: Partial<Record<AutonomyAction, AutonomyLevel>> }>("autonomy.get", {
          accountId,
        }),
      ]),
    );
    if (result) {
      setItems(result[0].requests);
      setLevels(result[1]?.levels ?? {});
    }
  };
  const approve = async (item: FacebookManagementRequest, forChat = false) => {
    const confirmLabel = forChat ? t("Approve for chat") : t("Approve");
    if (
      !(await confirm.confirm({
        title: titles[item.operation],
        message: `Facebook · ${item.pageId}`,
        details: details(item),
        confirmLabel,
        danger: item.operation === "facebook.post.delete" || item.details.action === "delete",
      }))
    )
      return;
    const result = await work.write(item.id, () =>
      client.request<FacebookManagementRequest>("facebook.management.approve", {
        accountId,
        reviewed: item,
        ...(forChat ? { forChat } : {}),
      }),
    );
    if (result) setItems((current) => current?.map((row) => (row.id === result.id ? result : row)));
  };
  const canApproveForChat = (item: FacebookManagementRequest) => {
    const action = facebookManagementAutonomy(item);
    return item.status === "pending" && action && levels[action] === "approve";
  };
  const dismiss = async (item: FacebookManagementRequest) => {
    const result = await work.write(item.id, () =>
      client.request("facebook.management.dismiss", { accountId, id: item.id }),
    );
    if (result) setItems((current) => current?.filter((row) => row.id !== item.id));
  };

  return (
    <section className="social-fb-stack" aria-label={t("Facebook requests")}>
      <div className="social-fb-toolbar">
        <Button
          variant={items ? "secondary" : "primary"}
          size="sm"
          loading={work.is("list")}
          onClick={() => void load().catch(() => undefined)}
        >
          {t("Refresh")}
        </Button>
        <Text as="span" size="caption" tone="muted">
          {t("Changes the assistant proposes wait here for your approval.")}
        </Text>
      </div>
      {!items && work.is("list") ? <LoadingText>{t("Loading…")}</LoadingText> : null}
      {items?.length === 0 ? (
        <EmptyState size="inline" description={t("No requests waiting.")} />
      ) : null}
      {items?.length ? (
        <ul className="social-fb-list">
          {items.map((item) => (
            <Surface key={item.id} as="li" variant="card" padding="sm" className="social-fb-item">
              <div className="social-fb-item-head">
                <Text as="span" weight="medium">
                  {titles[item.operation]}
                </Text>
                <Badge tone={item.status === "review" ? "warning" : "neutral"}>
                  {labels[item.status]}
                </Badge>
              </div>
              {detailList(item)}
              {item.status === "approved" ? (
                <Text as="p" size="secondary" tone="muted">
                  {t("Return to chat to apply this Facebook change.")}
                </Text>
              ) : null}
              <div className="social-fb-actions">
                {item.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={work.is(item.id)}
                    onClick={() => void approve(item).catch(() => undefined)}
                  >
                    {t("Approve")}
                  </Button>
                ) : null}
                {canApproveForChat(item) ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    loading={work.is(item.id)}
                    onClick={() => void approve(item, true).catch(() => undefined)}
                  >
                    {t("Approve for chat")}
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={item.status === "submitted" || work.is(item.id)}
                  onClick={() => void dismiss(item).catch(() => undefined)}
                >
                  {t("Dismiss")}
                </Button>
              </div>
            </Surface>
          ))}
        </ul>
      ) : null}
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {confirm.dialog}
    </section>
  );
}
