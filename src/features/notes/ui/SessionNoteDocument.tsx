import { useEffect, useRef, useState, type MutableRefObject } from "react";
import type { EditorView } from "@codemirror/view";
import { t, useLocale } from "../../../shared/i18n";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Tabs, TabList, Tab, TabPanel } from "../../../shared/ui/Tabs";
import type { NoteInputOwner } from "../notesInputOwners";
import { NoteEditablePreview } from "./NoteEditablePreview";
import { NoteEditorPane } from "./NoteEditorPane";
import { NoteMarkdownEditor, NoteMarkdownToolbar } from "./NoteMarkdownEditor";
import { useNoteEditorMode } from "./useNoteEditorMode";

/** Reads the text the user has selected in the visible editor, for "Add to chat". */
export type SessionNoteSelection = { current: (() => string) | null };

/**
 * The session dock's body editor: the library's Document / Source editor and
 * formatting toolbar, bound to the dock's own draft owner and save queue.
 */
export function SessionNoteDocument({
  noteId,
  body,
  cwd,
  inputOwner,
  readOnly,
  autoFocus,
  onFocused,
  onChange,
  onSave,
  selectionRef,
  onBlur,
  onRejectedInput,
}: {
  noteId: string;
  body: string;
  cwd?: string;
  inputOwner: NoteInputOwner;
  readOnly: boolean;
  autoFocus: boolean;
  onFocused: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  selectionRef: SessionNoteSelection;
  /** Focus left the editor: flush the pending save. */
  onBlur: () => void;
  onRejectedInput: (text: string) => void;
}) {
  useLocale();
  const [previewEditing, setPreviewEditing] = useState(false);
  const { detailRef, visibleMode, modeRef, setMode, setToolbarTarget } = useNoteEditorMode(
    `session-dock:${noteId}`,
    previewEditing,
  );
  const editorViewRef = useRef<EditorView | null>(null);
  const previewViewRef = useRef<EditorView | null>(null);
  const previewRangeRef = useRef<{ from: number; to: number } | null>(null);
  const previewEditingRef = useRef(previewEditing);
  previewEditingRef.current = previewEditing;

  // Selection reads the editor on screen: the active Document block, else Source.
  selectionRef.current = () => {
    const view =
      modeRef.current === "preview" && previewEditingRef.current
        ? previewViewRef.current
        : modeRef.current === "source"
          ? editorViewRef.current
          : null;
    const range = view?.state.selection.main;
    return view && range && !range.empty ? view.state.sliceDoc(range.from, range.to) : "";
  };

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- moves DOM focus into the CodeMirror view when the dock requests it (new or switched note); Document starts from its own "Start writing" control
  useEffect(() => {
    if (!autoFocus) return;
    if (modeRef.current === "source") editorViewRef.current?.focus();
    onFocused();
  }, [autoFocus, onFocused, modeRef]);

  const toolbarView: MutableRefObject<EditorView | null> =
    visibleMode === "preview" ? previewViewRef : editorViewRef;
  return (
    <div ref={detailRef} className="session-note-document" onBlur={onBlur}>
      <Tabs
        value={visibleMode === "preview" ? "preview" : "source"}
        onValueChange={(next) => setMode(next as "preview" | "source")}
        panels="shared"
      >
        <div className="note-editor-toolbar session-note-toolbar" inert={readOnly}>
          <TabList label={t("Note sections")}>
            <Tab value="preview">{t("Document")}</Tab>
            <Tab value="source">{t("Source")}</Tab>
          </TabList>
          <NoteMarkdownToolbar
            viewRef={toolbarView}
            editing={visibleMode !== "preview" || previewEditing}
          />
        </div>
        <TabPanel
          tabIndex={undefined}
          {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "note-editor-body")}
        >
          <div className="note-layout">
            <NoteEditorPane
              label={t("Source")}
              scrollKey={`session-dock:${noteId}:source`}
              hidden={visibleMode === "preview"}
            >
              <NoteMarkdownEditor
                inputObserver={inputOwner.observer("source")}
                viewRef={editorViewRef}
                minHeight={0}
                showLineNumbers={false}
                value={body}
                readOnly={readOnly}
                onChange={onChange}
                onRejectedInput={onRejectedInput}
                onSave={onSave}
                onFocus={() => setToolbarTarget("source")}
              />
            </NoteEditorPane>
            <NoteEditorPane
              label={t("Document")}
              document
              scrollKey={`session-dock:${noteId}:document`}
              hidden={visibleMode === "source"}
            >
              <NoteEditablePreview
                stateObserver={inputOwner.observer("preview-state")}
                inputObserver={inputOwner.observer("preview-block")}
                canMutate={inputOwner.allowed}
                readOnly={readOnly}
                value={body}
                cwd={cwd}
                viewRef={previewViewRef}
                rangeRef={previewRangeRef}
                onEditingChange={setPreviewEditing}
                onFocus={() => setToolbarTarget("preview")}
                onChange={onChange}
                onSave={onSave}
              />
            </NoteEditorPane>
          </div>
        </TabPanel>
      </Tabs>
    </div>
  );
}
