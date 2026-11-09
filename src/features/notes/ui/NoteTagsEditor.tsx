import { t, useLocale } from "../../../shared/i18n";
import type { NativeInputPublication } from "../../../shared/lib/native-input-observer";
import { TagInput } from "../../../shared/ui/TagInput";
import { MAX_NOTE_TAGS, normalizeNoteTags } from "../notes";

export function NoteTagsEditor({
  tags,
  onChange,
  inputObserver,
  inputPublication,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  inputObserver?: import("../../../shared/lib/native-input-observer").NativeInputObserver;
  inputPublication?: NativeInputPublication;
}) {
  useLocale();
  return (
    <TagInput
      inputObserver={inputObserver}
      inputPublication={inputPublication}
      label={t("Tags")}
      hideLabel
      value={tags}
      maxTags={MAX_NOTE_TAGS}
      normalize={normalizeNoteTags}
      backspaceBehavior="remove"
      formatTag={(tag) => `#${tag}`}
      placeholder={t("Add tag…")}
      removeLabel={(tag) => t("Remove #{p0}", { p0: tag })}
      inputProps={{ "aria-label": t("Add note tag"), spellCheck: false, autoComplete: "off" }}
      onValueChange={(next) => {
        if (!sameTags(next, tags)) onChange(next);
      }}
    />
  );
}

export function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
