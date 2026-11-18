import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Select } from "../../../../shared/ui/Select";
import { Text } from "../../../../shared/ui/Text";
import type { LinkedInManagementReview } from "../../../../integrations/social/adapters/linkedin-manage";
import type { SocialThread } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "../accounts/useAccountWrite";

export function LinkedInCommentActions({
  client,
  thread,
}: {
  client: SocialClient;
  thread: SocialThread;
}) {
  const [choice, setChoice] = useState("LIKE");
  const [result, setResult] = useState<LinkedInManagementReview>();
  const { error, is, write } = useAccountWrite(t("Could not save changes."));
  const { confirm, dialog } = useConfirm();
  const options = [
    { value: "LIKE", label: t("Like") },
    { value: "PRAISE", label: t("Celebrate") },
    { value: "EMPATHY", label: t("Love") },
    { value: "INTEREST", label: t("Insightful") },
    { value: "APPRECIATION", label: t("Support") },
    { value: "ENTERTAINMENT", label: t("Funny") },
  ];
  const prepare = async (kind: "react" | "removeReaction" | "deleteComment") => {
    const accountId = thread.accountId;
    const review = await write("prepare", () =>
      client.request<LinkedInManagementReview>("linkedin.management.prepare", {
        accountId,
        kind,
        threadId: thread.id,
        ...(kind === "react" ? { reaction: choice } : {}),
      }),
    );
    if (!review) return;
    setResult(review);
    if (review.state !== "review") return;
    await confirm({
      title:
        kind === "react"
          ? t("Add reaction")
          : kind === "removeReaction"
            ? t("Remove reaction")
            : t("Delete comment"),
      message: [
        thread.events.find((event) => event.direction === "inbound")?.text ??
          thread.platformThreadId,
        kind === "react" ? options.find((option) => option.value === choice)?.label : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
      confirmLabel: t("Confirm"),
      danger: kind === "deleteComment",
      onConfirm: async () => {
        setResult(
          await write("submit", () =>
            client.request<LinkedInManagementReview>("linkedin.management.submit", {
              accountId,
              id: review.id,
              reviewed: review,
            }),
          ),
        );
      },
    });
  };
  return (
    <>
      <FieldGroup legend={t("Reactions")} layout="row" disabled={is("prepare") || is("submit")}>
        <Select
          label={t("Reactions")}
          hideLabel
          value={choice}
          options={options}
          onValueChange={setChoice}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void prepare("react").catch(() => undefined)}
        >
          {t("Add reaction")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void prepare("removeReaction").catch(() => undefined)}
        >
          {t("Remove reaction")}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void prepare("deleteComment").catch(() => undefined)}
        >
          {t("Delete comment")}
        </Button>
      </FieldGroup>
      {result?.state === "succeeded" ? <Text as="p">{t("Saved")}</Text> : null}
      {result?.state === "attempting" || result?.state === "inspect" ? (
        <InlineError>{t("Check the result on LinkedIn before trying again.")}</InlineError>
      ) : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {dialog}
    </>
  );
}
