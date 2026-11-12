import { t, useLocale } from "../../../shared/i18n";
import { useRef, useState } from "react";
import type { NativeInputPublication } from "../../../shared/lib/native-input-observer";
import { TagInput } from "../../../shared/ui/TagInput";
import { Button } from "../../../shared/ui/Button";
import { Popover } from "../../../shared/ui/Popover";
import { Plus } from "../../../shared/ui/icons";
import { MAX_NOTE_TAGS, normalizeNoteTags } from "../notes";
import { NOTE_TAG_PRESETS, noteTagSuggestions } from "../model/noteTagSuggestions";

export function NoteTagsEditor({
  tags,
  availableTags = [],
  onChange,
  inputObserver,
  inputPublication,
}: {
  tags: string[];
  availableTags?: readonly string[];
  onChange: (tags: string[]) => void;
  inputObserver?: import("../../../shared/lib/native-input-observer").NativeInputObserver;
  inputPublication?: NativeInputPublication;
}) {
  useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const suggestions = noteTagSuggestions(availableTags, tags);
  return (
    <div className="flex min-w-0 items-center gap-1">
      <TagInput
        className="min-w-0 flex-1"
        fieldVariant="compact"
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
      <Button
        ref={trigger}
        variant="ghost"
        size="sm"
        iconOnly
        label={t("Tags")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={tags.length >= MAX_NOTE_TAGS || suggestions.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        <Plus className="icon-xs" />
      </Button>
      {open ? (
        <Popover
          anchor={trigger}
          kind="dialog"
          aria-label={t("Tags")}
          width={280}
          padding={8}
          flow="scroll"
          onDismiss={() => setOpen(false)}
        >
          <div className="flex flex-wrap gap-1">
            {suggestions.map((tag) => {
              const preset = NOTE_TAG_PRESETS.find((candidate) => candidate.value === tag);
              return (
                <Button
                  key={tag}
                  variant="secondary"
                  size="sm"
                  disabled={tags.length >= MAX_NOTE_TAGS}
                  onClick={() => {
                    const next = normalizeNoteTags([...tags, tag]);
                    if (!sameTags(next, tags)) onChange(next);
                  }}
                >
                  {preset ? t(preset.label) : `#${tag}`}
                </Button>
              );
            })}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

export function sameTags(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}
