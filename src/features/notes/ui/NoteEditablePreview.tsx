import { Button } from "../../../shared/ui/Button";
import { Pencil } from "../../../shared/ui/icons";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
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

  const deferredValue = useDeferredValue(value);
  const previewValue = currentActive ? value : deferredValue;
  const blocks = useMemo(() => notePreviewBlocks(previewValue), [previewValue]);
  const definitions = useMemo(
    () =>
      blocks
        .filter((block) => block.definition)
        .map((block) => block.text)
        .join("\n"),
    [blocks],
  );
  const start = (from: number, to: number) => {
    if (deferredValue !== value) return;
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
  const renderBlocks = (from = 0, to = previewValue.length) =>
    blocks
      .map((block, index) => ({ block, index }))
      .filter(({ block }) => block.from >= from && block.to <= to)
      .map(({ block, index }) => (
        <div key={index} className="note-preview-block">
          <div
            role="button"
            tabIndex={0}
            aria-label={t("Edit note block")}
            className="note-preview-content"
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("a, button, input, [role='menu']")) return;
              if (window.getSelection()?.toString()) return;
              start(block.from, block.to);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key))
                return;
              event.preventDefault();
              start(block.from, block.to);
            }}
          >
            {block.definition ? (
              <pre className="whitespace-pre-wrap text-[12px] text-content/70">{block.text}</pre>
            ) : (
              <AgentMarkdown text={`${block.text}\n\n${definitions}`} cwd={cwd} hardBreaks />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            iconOnly
            label={t("Edit note block")}
            className="note-edit-block note-preview-edit"
            onClick={() => start(block.from, block.to)}
          >
            <Pencil className="size-3.5" />
          </Button>
        </div>
      ));

  return (
    <div data-note-preview className="min-w-0 select-text">
      {currentActive ? (
        <>
          {renderBlocks(0, currentActive.from)}
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
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="note-edit-block"
              onClick={finish}
            >
              {t("Done")}
            </Button>
          </div>
          {renderBlocks(currentActive.to)}
        </>
      ) : (
        renderBlocks()
      )}
      <Button variant="ghost" size="sm" type="button" className="note-add-block" onClick={append}>
        {value.trim() ? t("Add text") : t("Start writing")}
      </Button>
    </div>
  );
}
