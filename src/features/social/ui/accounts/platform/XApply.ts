import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

export type XApplyKind =
  | "deletePost"
  | "like"
  | "repost"
  | "bookmark"
  | "hideReply"
  | "follow"
  | "mute"
  | "block"
  | "createList"
  | "updateList"
  | "deleteList"
  | "addListMember"
  | "removeListMember";

export type XApplyFields = {
  postId?: string;
  userId?: string;
  listId?: string;
  name?: string;
  enabled?: boolean;
};

type XApplyResult = {
  status: "applied" | "review";
  result?: { pending?: boolean; listId?: string };
};

/**
 * The one reviewed X write: the owner confirms the exact change, then the Host applies it with a
 * fresh intent id. Resolves true only when X confirmed it; an uncertain outcome is shown as a notice.
 */
export function useXApply(account: SocialAccount, client: SocialClient) {
  const { confirm, dialog } = useConfirm();
  const { error, details, is, write } = useAccountWrite(
    t("The X action needs review. Check the result on X before sending again."),
  );
  const [notice, setNotice] = useState("");
  const apply = async (request: {
    kind: XApplyKind;
    title: string;
    details: string;
    fields: XApplyFields;
    danger?: boolean;
  }): Promise<boolean> => {
    const approved = await confirm({
      title: request.title,
      message: t("Apply this action to {p0}?", { p0: account.name }),
      details: request.details,
      confirmLabel: request.kind === "deletePost" ? t("Delete") : t("Apply"),
      danger: request.danger ?? false,
    });
    if (!approved) return false;
    setNotice("");
    const applied = await write("apply", async () => {
      const result = await client.request<XApplyResult>("x.apply", {
        accountId: account.id,
        kind: request.kind,
        ...request.fields,
        intentId: crypto.randomUUID(),
        confirm: "APPLY_X_ACTION",
      });
      setNotice(
        result.status === "review"
          ? t("The X action needs review. Check the result on X before sending again.")
          : result.result?.pending
            ? t("Follow request pending")
            : request.kind === "createList"
              ? t("List created.")
              : t("Applied"),
      );
      return result.status === "applied";
    });
    return applied === true;
  };
  return { apply, busy: is("apply"), error, details, notice, dialog };
}
