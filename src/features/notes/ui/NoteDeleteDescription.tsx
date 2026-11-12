import { Text } from "../../../shared/ui/Text";
import { t } from "../../../shared/i18n";
import type { NoteSummary } from "../notes";

/** The body of the permanent-delete confirmation: what goes, and what the filters hide. */
export function NoteDeleteDescription({
  targets,
  visible,
}: {
  targets: NoteSummary[];
  visible: NoteSummary[];
}) {
  const hidden = targets.filter((note) => !visible.some((item) => item.id === note.id));
  return (
    <Text
      as="span"
      size="secondary"
      tone="secondary"
      leading="relaxed"
      className="note-delete-description"
    >
      <span className="block">
        {t("This cannot be undone. Unsaved changes in the selected notes will also be deleted.")}
      </span>
      <span className="block">
        {targets
          .slice(0, 5)
          .map((note) => note.title || t("Untitled"))
          .join(" · ")}
      </span>
      {targets.length > 5 ? (
        <span className="block">{t("And {p0} more", { p0: targets.length - 5 })}</span>
      ) : null}
      {hidden.length ? (
        <span className="block">
          {t("{p0} of them are hidden by the current filters.", { p0: hidden.length })}
        </span>
      ) : null}
    </Text>
  );
}
