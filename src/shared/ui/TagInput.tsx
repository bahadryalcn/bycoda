import { TagInput as ArcTagInput, type TagInputProps } from "./arc/tag-input/tag-input";
import { useT } from "../i18n";

export type { TagInputProps } from "./arc/tag-input/tag-input";

/**
 * Editable token list: type and press Enter to add, Backspace to select then remove, with localized labels and
 * screen-reader announcements. The consumer owns the tag array and validation.
 * `fieldVariant="compact"` uses the shared compact field height for toolbar metadata.
 * @group fields
 * @use Free-form list of short values (labels, aliases, keywords, rules).
 * @avoid Choosing from a fixed set: Select or SearchableSelect. One value: TextField.
 * @arc tag-input
 */
export function TagInput({ className, ...props }: TagInputProps) {
  const t = useT();
  return (
    <ArcTagInput
      placeholder={t("Add tag…")}
      removeLabel={(tag) => t("Remove {p0}", { p0: tag })}
      selectedAnnouncement={(tag) => t("{p0} selected. Press Backspace to remove it.", { p0: tag })}
      removedAnnouncement={(tag) => `${t("Removed: ")}${tag}`}
      {...props}
      className={["bycoda-arc", className].filter(Boolean).join(" ")}
    />
  );
}
