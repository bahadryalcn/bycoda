import type { CSSProperties } from "react";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { OutputBlock } from "../../../shared/ui/OutputBlock";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction } from "../../../shared/ui/ActionHost";
import { Pencil } from "../../../shared/ui/icons";
import {
  useDeferredValue,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type { EditorView } from "@codemirror/view";
import { useT } from "../../../shared/i18n";
import { AgentMarkdown } from "../../sessions/ui/AgentMarkdown";
import { NotePreviewParser, notePreviewReferences, replacePreviewBlock } from "../previewBlocks";
import { NoteMarkdownEditor } from "./NoteMarkdownEditor";
import type { NativeInputObserver } from "../../../shared/lib/native-input-observer";

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
  inputObserver,
  stateObserver,
  canMutate,
  readOnly = false,
}: {
  value: string;
  cwd?: string;
  viewRef: MutableRefObject<EditorView | null>;
  rangeRef: MutableRefObject<{ from: number; to: number } | null>;
  onChange: (value: string) => void;
  onSave: () => void;
  onPasteImages?: (files: File[]) => void;
  onEditingChange: (editing: boolean) => void;
  onFocus: () => void;
  inputObserver?: NativeInputObserver;
  stateObserver?: NativeInputObserver;
  canMutate?: () => boolean;
  readOnly?: boolean;
}) {
  const t = useT();
  const previewRoot = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<{
    from: number;
    to: number;
    preview: string;
    previewFrom: number;
    previewTo: number;
  } | null>(null);
  const localValue = useRef(value);
  const callbacks = useRef({ onEditingChange });
  callbacks.current = { onEditingChange };
  // A source edit or host update invalidates the selected source range.
  const currentActive = localValue.current === value ? active : null;
  const inputState = useRef({ value, active: currentActive });
  useLayoutEffect(() => {
    inputState.current = { value, active: currentActive };
  });
  useLayoutEffect(() => {
    const registration = stateObserver?.attach(
      () => ({
        snapshot: {
          inputKind: "preview-range",
          value: inputState.current.value,
          active: inputState.current.active,
        },
        ...(inputState.current.active && !viewRef.current ? { busy: "notes-view-loading" } : {}),
      }),
      { canClose: () => true, close: () => {} },
    );
    return () => registration?.unregister();
  }, [stateObserver, viewRef]);
  rangeRef.current = currentActive ? { from: currentActive.from, to: currentActive.to } : null;
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
  // The selected block is a source editor. Its unchanged neighbours need no
  // reparse/reconciliation until editing ends; retain their original ranges.
  const previewValue = currentActive ? currentActive.preview : deferredValue;
  const parser = useRef<NotePreviewParser | null>(null);
  if (!parser.current) parser.current = new NotePreviewParser();
  const blocks = useMemo(() => parser.current!.parse(previewValue), [previewValue]);
  const referencesFor = useMemo(() => notePreviewReferences(blocks), [blocks]);
  const start = (from: number, to: number) => {
    if (readOnly || (canMutate && !canMutate())) return;
    if (!currentActive && deferredValue !== value) return;
    if (currentActive && from >= currentActive.previewTo) {
      const shift = currentActive.to - currentActive.previewTo;
      from += shift;
      to += shift;
    }
    localValue.current = value;
    setActive({ from, to, preview: value, previewFrom: from, previewTo: to });
    onEditingChange(true);
    onFocus();
  };
  const finish = () => {
    const from = currentActive?.from;
    setActive(null);
    onEditingChange(false);
    // Leaving source-range editing is a view action. Changes have already
    // reached the canonical draft/autosave owner; explicit Save stays separate.
    requestAnimationFrame(() => {
      previewRoot.current
        ?.querySelector<HTMLElement>(`[data-note-block-from="${from}"] [data-action-primary]`)
        ?.focus();
    });
  };
  const append = () => {
    if (readOnly || (canMutate && !canMutate())) return;
    const next = value.trim() && !value.endsWith("\n\n") ? `${value}\n\n` : value;
    localValue.current = next;
    setActive({
      from: next.length,
      to: next.length,
      preview: next,
      previewFrom: next.length,
      previewTo: next.length,
    });
    onEditingChange(true);
    onFocus();
    if (next !== value) onChange(next);
  };
  const beginBlock = useRef(start);
  beginBlock.current = start;
  const renderBlocks = useCallback(
    (from = 0, to = Infinity) =>
      blocks
        .filter((block) => block.from >= from && block.to <= to)
        .map((block) => (
          <ActionHost
            key={block.key}
            data-note-block-from={block.from}
            className="note-preview-block items-start gap-1 [content-visibility:auto] [contain-intrinsic-size:var(--layout-contain-intrinsic-size)]"
            style={{ "--layout-contain-intrinsic-size": "auto 64px" } as CSSProperties}
          >
            <div
              role="button"
              data-action-primary
              tabIndex={0}
              aria-label={t("Edit note block")}
              className="note-preview-content"
              onClick={(event) => {
                if ((event.target as HTMLElement).closest("a, button, input, [role='menu']"))
                  return;
                if (window.getSelection()?.toString()) return;
                beginBlock.current(block.from, block.to);
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget || !["Enter", " "].includes(event.key))
                  return;
                event.preventDefault();
                beginBlock.current(block.from, block.to);
              }}
            >
              {block.definition ? (
                <OutputBlock>{block.text}</OutputBlock>
              ) : (
                <AgentMarkdown
                  text={`${block.text}\n\n${referencesFor(block.text)}`}
                  cwd={cwd}
                  hardBreaks
                />
              )}
            </div>
            <InlineAction
              type="button"
              label={t("Edit note block")}
              onClick={() => beginBlock.current(block.from, block.to)}
            >
              <Pencil className="icon-sm" />
            </InlineAction>
          </ActionHost>
        )),
    [blocks, referencesFor, cwd, t],
  );

  const previewFrom = currentActive?.previewFrom ?? previewValue.length;
  const previewTo = currentActive?.previewTo;
  const before = useMemo(() => renderBlocks(0, previewFrom), [renderBlocks, previewFrom]);
  const after = useMemo(
    () => (previewTo === undefined ? null : renderBlocks(previewTo)),
    [renderBlocks, previewTo],
  );

  return (
    <div ref={previewRoot} data-note-preview className="min-w-0 select-text">
      {currentActive ? (
        <>
          {before}
          <div
            {...surfaceAttributes({ radius: "control", variant: "selected" }, "note-active-block")}
          >
            <NoteMarkdownEditor
              readOnly={readOnly}
              inputObserver={inputObserver}
              viewRef={viewRef}
              value={value.slice(currentActive.from, currentActive.to)}
              autoFocus
              minHeight={24}
              showLineNumbers={false}
              onFocus={onFocus}
              onChange={(next) => {
                if (readOnly || (canMutate && !canMutate())) return;
                const updated = replacePreviewBlock(
                  value,
                  currentActive.from,
                  currentActive.to,
                  next,
                );
                localValue.current = updated;
                setActive({ ...currentActive, to: currentActive.from + next.length });
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
              {t("Read document")}
            </Button>
          </div>
          {after}
        </>
      ) : (
        before
      )}
      <Button variant="ghost" size="sm" type="button" className="note-add-block" onClick={append}>
        {value.trim() ? t("Add text") : t("Start writing")}
      </Button>
    </div>
  );
}
