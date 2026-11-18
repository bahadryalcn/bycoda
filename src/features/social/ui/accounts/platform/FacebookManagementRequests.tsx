import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Badge } from "../../../../../shared/ui/Badge";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import {
  facebookManagementAutonomy,
  type FacebookManagementRequest,
} from "../../../model/facebookManagement";
import type { AutonomyLevel, AutonomyAction } from "../../../model/autonomy";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

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
    <section className="social-card" aria-label={t("Facebook requests")}>
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        loading={work.is("list")}
        onClick={() => void load().catch(() => undefined)}
      >
        {t("Refresh")}
      </Button>
      {items?.length === 0 ? <EmptyState size="inline" description={t("No results")} /> : null}
      {items?.map((item) => (
        <div key={item.id} className="social-card">
          <div className="social-field-row">
            <Text as="span">{titles[item.operation]}</Text>
            <Badge tone={item.status === "review" ? "warning" : "neutral"}>
              {labels[item.status]}
            </Badge>
          </div>
          {details(item)}
          {item.status === "approved" ? (
            <Text as="p">{t("Return to chat to apply this Facebook change.")}</Text>
          ) : null}
          <div className="social-field-row">
            {item.status === "pending" ? (
              <Button
                size="sm"
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
              variant="secondary"
              size="sm"
              disabled={item.status === "submitted" || work.is(item.id)}
              onClick={() => void dismiss(item).catch(() => undefined)}
            >
              {t("Dismiss")}
            </Button>
          </div>
        </div>
      ))}
      {work.error ? <InlineError>{work.error}</InlineError> : null}
      {confirm.dialog}
    </section>
  );
}
