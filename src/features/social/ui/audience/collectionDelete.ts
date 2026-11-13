import { t } from "../../../../shared/i18n";
import type { ConfirmRequest } from "../../../../shared/ui/ConfirmDialog";
import type { SocialList } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import { collectionKind, listDisplayName, listUses } from "./audienceModel";

type Confirm = (request: ConfirmRequest) => Promise<boolean>;

/**
 * Deletes a custom list or segment after showing what it affects. The Host refuses a list that a
 * capture rule or an unfinished sequence still uses; the same check runs here first so the person
 * sees which work to change instead of a bare refusal. People are never deleted.
 */
export async function deleteCollection(
  client: SocialClient,
  confirm: Confirm,
  list: SocialList,
): Promise<"deleted" | "kept"> {
  if (list.system) return "kept";
  const [rules, sequences] = await Promise.all([
    client.captureRules.list(),
    client.sequences.list(),
  ]);
  const uses = listUses(list, rules.items, sequences.items);
  const name = listDisplayName(list);
  if (uses.rules.length || uses.sequences.length) {
    await confirm({
      title: t("{p0} is still in use", { p0: name }),
      message: t("Change or delete the work below first. Nothing was deleted."),
      confirmLabel: t("Delete"),
      cancelLabel: t("Close"),
      confirmDisabled: true,
      consequences: [
        ...uses.rules.map((rule) => ({
          key: `rule-${rule.id}`,
          tone: "warning" as const,
          content: t("Capture rule {p0} adds people to this list.", { p0: rule.name }),
        })),
        ...uses.sequences.map((sequence) => ({
          key: `sequence-${sequence.id}`,
          tone: "warning" as const,
          content: t("Sequence {p0} sends to this list.", { p0: sequence.name }),
        })),
      ],
    });
    return "kept";
  }
  const segment = collectionKind(list) === "segment";
  const ok = await confirm({
    title: segment ? t("Delete this segment?") : t("Delete this list?"),
    message: t("Delete {p0}?", { p0: name }),
    confirmLabel: t("Delete"),
    pendingLabel: t("Deleting…"),
    danger: true,
    consequences: [
      segment
        ? t("Only the saved conditions are removed. No person is deleted.")
        : t("The people in it are not deleted. They stay in your audience and in other lists."),
    ],
    onConfirm: async () => {
      await client.lists.delete(list.id);
    },
  });
  return ok ? "deleted" : "kept";
}
