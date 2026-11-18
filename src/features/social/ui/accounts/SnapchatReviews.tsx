import { useState } from "react";
import type { SnapchatDeleteInput } from "../../../../integrations/social/snapchat-content";
import type { SnapchatProfilePatch } from "../../../../integrations/social/snapchat-profile";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { Text } from "../../../../shared/ui/Text";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";

type Review = {
  id: string;
  accountId: string;
  status: "pending" | "review";
} & (
  | {
      action: "delete";
      input: Omit<SnapchatDeleteInput, "target"> & {
        target: SnapchatDeleteInput["target"] | "story";
      };
    }
  | { action: "profile.update"; input: { patch: SnapchatProfilePatch } }
  | { action: "profile.create"; input: { patch: SnapchatProfilePatch } }
);

function details(review: Review) {
  if (review.action === "delete")
    return [
      ["Target", review.input.target],
      ["ID", review.input.id],
    ] as const;
  const patch = review.input.patch ?? {};
  return [
    ["Profile name", patch.name],
    ["About", patch.bio],
    ["Profile picture", patch.avatarUploadId],
    ["Website", patch.website],
    ["Category", patch.category],
  ] as const;
}

function actionLabel(action: Review["action"]) {
  switch (action) {
    case "delete":
      return t("Delete this Snapchat publication?");
    case "profile.update":
      return t("Save changes?");
    case "profile.create":
      return t("Create Public Profile");
  }
}

export function SnapchatReviews({
  client,
  accountId,
  accountName,
  disabled,
  canApprove,
}: {
  client: SocialClient;
  accountId: string;
  accountName: string;
  disabled: boolean;
  canApprove: boolean;
}) {
  const [reviews, setReviews] = useState<Review[]>();
  const [selected, setSelected] = useState<Review>();
  const confirmation = useConfirm();
  const { error, is, write } = useAccountWrite(t("Something went wrong. Try again."));
  const read = async () => {
    const found = await client.request<Review[]>("snapchat.review.list", { accountId });
    setReviews(found.filter((item) => item.accountId === accountId));
  };
  const decide = (item: Review, approve: boolean) =>
    write("decision", async () => {
      if (approve)
        setReviews((current) =>
          current?.map((review) =>
            review.id === item.id ? { ...review, status: "review" } : review,
          ),
        );
      await client.request<{ status: "dismissed" | "completed" }>("snapchat.review.decide", {
        accountId,
        id: item.id,
        approve,
      });
      setReviews((current) => current?.filter((review) => review.id !== item.id));
    });
  const renderDetails = (item: Review) =>
    details(item).map(([label, value]) =>
      typeof value === "string" ? (
        <Text key={label} as="p" size="secondary" wrap="anywhere">
          {t(label)} · {value || t("Empty")}
        </Text>
      ) : null,
    );
  const approval = (item: Review) => ({
    title: actionLabel(item.action),
    context: accountName,
    message: renderDetails(item),
    confirmLabel: t("Approve"),
    danger: item.action === "delete",
    requireText:
      item.action === "delete" ? { text: item.input.id, caseSensitive: true } : undefined,
    onConfirm: async () => {
      if (
        disabled ||
        !canApprove ||
        is("read") ||
        is("decision") ||
        !reviews?.some((review) => review.id === item.id && review.status === "pending")
      )
        throw new Error(t("Action unavailable."));
      await decide(item, true);
    },
  });
  const confirm = async (item: Review) => {
    setSelected(item);
    try {
      await confirmation.confirm(approval(item));
    } finally {
      setSelected(undefined);
    }
  };
  return (
    <Disclosure summary={t("Snapchat reviews")} variant="row">
      <div className="social-card">
        <div className="social-field-row">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled || is("decision")}
            loading={is("read")}
            onClick={() => void write("read", read).catch(() => undefined)}
          >
            {t("Refresh")}
          </Button>
        </div>
        {error ? <InlineError>{error}</InlineError> : null}
        {!error && !is("read") && !is("decision") && reviews?.length === 0 ? (
          <EmptyState size="inline" context="list" title={t("Nothing to review.")} />
        ) : null}
        {reviews?.map((item) => (
          <Disclosure key={item.id} variant="row" summary={actionLabel(item.action)}>
            <div className="social-card">
              {renderDetails(item)}
              {item.status === "review" ? (
                <InlineMessage tone="warning">
                  {t("Snapchat outcome uncertain. Check the account before trying again.")}
                </InlineMessage>
              ) : null}
              <div className="social-field-row">
                {item.status === "pending" ? (
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={disabled || !canApprove || is("read") || is("decision")}
                    onClick={() => void confirm(item).catch(() => undefined)}
                  >
                    {t("Approve")}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={disabled || is("read")}
                  loading={is("decision")}
                  onClick={() => void decide(item, false).catch(() => undefined)}
                >
                  {t("Dismiss")}
                </Button>
              </div>
            </div>
          </Disclosure>
        ))}
      </div>
      {selected ? confirmation.renderDialog(approval(selected)) : null}
    </Disclosure>
  );
}
