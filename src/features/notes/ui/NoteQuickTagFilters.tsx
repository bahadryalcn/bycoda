import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ScrollArea } from "../../../shared/ui/ScrollArea";

/** A single-click library scope; selection/drafts stay owned by NotesView. */
export function NoteQuickTagFilters({
  tags,
  selected,
  onSelect,
}: {
  tags: readonly string[];
  selected: string | null;
  onSelect: (tag: string | null) => void;
}) {
  useLocale();
  if (!tags.length) return null;
  return (
    <ScrollArea
      axis="x"
      scrollbar="hidden"
      className="note-quick-tags"
      role="group"
      aria-label={t("Filter by tag")}
    >
      <Button
        variant={selected === null ? "secondary" : "ghost"}
        size="sm"
        shape="pill"
        truncate
        pressed={selected === null}
        onClick={() => onSelect(null)}
      >
        {t("All tags")}
      </Button>
      {tags.map((tag) => (
        <Button
          key={tag}
          variant={selected === tag ? "secondary" : "ghost"}
          size="sm"
          shape="pill"
          truncate
          tooltip={`#${tag}`}
          tooltipWhen="overflow"
          pressed={selected === tag}
          onClick={() => onSelect(selected === tag ? null : tag)}
        >
          #{tag}
        </Button>
      ))}
    </ScrollArea>
  );
}
