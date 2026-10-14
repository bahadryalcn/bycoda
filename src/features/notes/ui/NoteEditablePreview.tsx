import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { t, useLocale } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { notePreviewBlocks, replacePreviewBlock } from "../previewBlocks";
import { NoteMarkdownEditor } from "./NoteMarkdownEditor";

export function NoteEditablePreview({
  value,
  cwd,
  viewRef,
  rangeRef,
  onChange,
  onSave,
  onPasteImages,
  onEditingChange,
  onFocus,
}: {
  value: string;
  cwd?: string;
  viewRef: MutableRefObject<EditorView | null>;
  rangeRef: MutableRefObject<{ from: number; to: number } | null>;
  onChange: (value: string) => void;
  onSave: () => void;
  onPasteImages: (files: File[]) => void;
  onEditingChange: (editing: boolean) => void;
  onFocus: () => void;
}) {
  useLocale();
  const [active, setActive] = useState<{ from: number; to: number } | null>(null);
  const localValue = useRef(value);
  const callbacks = useRef({ onEditingChange });
  callbacks.current = { onEditingChange };
  // A source edit or host update invalidates the selected source range.
  const currentActive = localValue.current === value ? active : null;
  rangeRef.current = currentActive;
  useEffect(() => {
    if (localValue.current !== value) {
      localValue.current = value;
      setActive(null);
      callbacks.current.onEditingChange(false);
    }
  }, [value]);
  useEffect(
    () => () => {
      rangeRef.current = null;
      callbacks.current.onEditingChange(false);
    },
    [rangeRef],
  );

  const definitions = useMemo(
    () =>
      notePreviewBlocks(value)
        .filter((block) => block.definition)
        .map((block) => block.text)
        .join("\n"),
    [value],
  );
  const start = (from: number, to: number) => {
    localValue.current = value;
    setActive({ from, to });
    onEditingChange(true);
    onFocus();
  };
  const finish = () => {
    setActive(null);
    onEditingChange(false);
    onSave();
  };
  const append = () => {
    const next = value.trim() && !value.endsWith("\n\n") ? `${value}\n\n` : value;
    localValue.current = next;
    setActive({ from: next.length, to: next.length });
    onEditingChange(true);
    onFocus();
    if (next !== value) onChange(next);
  };
  const renderBlocks = (text: string, offset = 0) =>
    notePreviewBlocks(text).map((block) => (
      <div key={offset + block.from} className="note-preview-block">
        <div
          role="button"
          tabIndex={0}
          aria-label={t("Edit note block")}
          className="note-preview-content"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a, button, input, [role='menu']")) return;
            if (window.getSelection()?.toString()) return;
            start(offset + block.from, offset + block.to);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key)) return;
            event.preventDefault();
            start(offset + block.from, offset + block.to);
          }}
        >
          {block.definition ? (
            <pre className="whitespace-pre-wrap text-[12px] text-content/70">{block.text}</pre>
          ) : (
            <AgentMarkdown text={`${block.text}\n\n${definitions}`} cwd={cwd} hardBreaks />
          )}
        </div>
        <button
          type="button"
          className="note-edit-block"
          onClick={() => start(offset + block.from, offset + block.to)}
        >
          {t("Edit block")}
        </button>
      </div>
    ));

  return (
    <div data-note-preview className="min-w-0 select-text">
      <p className="mbs-2 text-[11px] text-content/60">
        {t("Select a block to edit it. Formatting uses Markdown.")}
      </p>
      {currentActive ? (
        <>
          {renderBlocks(value.slice(0, currentActive.from))}
          <div className="note-active-block">
            <NoteMarkdownEditor
              viewRef={viewRef}
              value={value.slice(currentActive.from, currentActive.to)}
              autoFocus
              minHeight={96}
              showLineNumbers={false}
              onFocus={onFocus}
              onChange={(next) => {
                const updated = replacePreviewBlock(
                  value,
                  currentActive.from,
                  currentActive.to,
                  next,
                );
                localValue.current = updated;
                setActive({ from: currentActive.from, to: currentActive.from + next.length });
                onChange(updated);
              }}
              onSave={onSave}
              onPasteImages={onPasteImages}
            />
            <button type="button" className="note-edit-block" onClick={finish}>
              {t("Done")}
            </button>
          </div>
          {renderBlocks(value.slice(currentActive.to), currentActive.to)}
        </>
      ) : (
        renderBlocks(value)
      )}
      <button type="button" className="note-add-block" onClick={append}>
        {value.trim() ? t("Add text") : t("Start writing")}
      </button>
    </div>
  );
}
