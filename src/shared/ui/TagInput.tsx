import { TagInput as ArcTagInput, type TagInputProps } from "./arc/tag-input/tag-input";
import { useT } from "../i18n";

export type { TagInputProps } from "./arc/tag-input/tag-input";

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
