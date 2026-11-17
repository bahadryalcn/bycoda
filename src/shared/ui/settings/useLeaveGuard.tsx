import { useT } from "../../i18n";
import { useConfirm } from "../ConfirmDialog";
import {
  discardAllPending,
  pendingChangeCount,
  usePendingSources,
  saveAllPending,
} from "./pendingChanges";

/**
 * Asks before leaving while any settings editor has unsaved changes: Save and leave, Discard
 * and leave, or Keep editing. Wrap every way out of a settings page (category change, close)
 * with `guard`; with nothing unsaved it runs `leave` at once.
 */
export function useLeaveGuard() {
  const t = useT();
  const { confirm, dialog } = useConfirm();
  const sources = usePendingSources();
  function guard(leave: () => void) {
    if (!sources.length) return leave();
    const count = pendingChangeCount(sources);
    const saving = sources.some((source) => source.pending);
    void confirm({
      title: t("Save changes before leaving?"),
      message: saving
        ? t("Saving…")
        : count === 1
          ? t("1 unsaved change")
          : t("{p0} unsaved changes", { p0: count }),
      consequences: sources.map((source) =>
        source.changes.length === 1
          ? t("{p0}: 1 change", { p0: source.title })
          : t("{p0}: {p1} changes", { p0: source.title, p1: source.changes.length }),
      ),
      tone: "neutral",
      confirmLabel: t("Save and leave"),
      pendingLabel: t("Saving…"),
      cancelLabel: t("Keep editing"),
      confirmDisabled: saving || sources.some((source) => !source.canSave),
      alternative: saving
        ? undefined
        : {
            label: t("Discard and leave"),
            danger: true,
            onSelect: () => {
              if (!discardAllPending()) return;
              leave();
            },
          },
      onConfirm: async () => {
        if (!(await saveAllPending()))
          throw new Error(t("Some changes were not saved. Review them, then try again."));
      },
    }).then(
      (saved) => {
        if (saved) leave();
      },
      () => undefined,
    );
  }
  return { guard, dialog };
}
