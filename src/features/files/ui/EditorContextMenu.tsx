import { selectAll } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { EditorView } from "@codemirror/view";
import { t, useLocale } from "../../../shared/i18n/technical";
import { ContextMenu, type ContextMenuItem } from "../../../shared/ui/ContextMenu";
import { formatShortcutLabel, usePlatform } from "../../../shared/ui/shortcut";
import { editorCodeSelection, formatEditorSelectionReference } from "../model/editorSelection";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import {
  sharedRedo,
  sharedRedoDepth,
  sharedUndo,
  sharedUndoDepth,
} from "../editor/editorSharedHistory";

export type EditorContextTarget = {
  x: number;
  y: number;
  view: EditorView;
  isCurrent: () => boolean;
  format?: () => void;
  save?: () => void;
};

export function EditorContextMenu({
  target,
  path,
  onClose,
  onError,
}: {
  target: EditorContextTarget;
  path: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  useLocale();
  const platform = usePlatform();
  const { view } = target;
  const writable = () =>
    target.isCurrent() && !view.state.readOnly && view.state.facet(EditorView.editable);
  const selection = editorCodeSelection(view.state, path);
  const hasSelection = view.state.selection.ranges.some((range) => !range.empty);
  const item = (
    id: string,
    label: string,
    disabled = false,
    shortcut?: string,
  ): ContextMenuItem => ({
    kind: "item",
    id,
    label,
    disabled,
    shortcut: shortcut ? formatShortcutLabel(shortcut, platform).text : undefined,
  });
  const items: ContextMenuItem[] = [
    item("undo", t("Undo"), !writable() || sharedUndoDepth(view) === 0, "Mod+Z"),
    item("redo", t("Redo"), !writable() || sharedRedoDepth(view) === 0, "Mod+Shift+Z"),
    { kind: "sep" },
    item("cut", t("Cut"), !writable() || !hasSelection, "Mod+X"),
    item("copy", t("Copy"), !hasSelection, "Mod+C"),
    item("paste", t("Paste"), !writable(), "Mod+V"),
    item("select", t("Select All"), false, "Mod+A"),
    { kind: "sep" },
    item("find", t("Find"), false, "Mod+F"),
    ...(target.format ? [item("format", t("Format document"), !writable(), "Alt+Shift+F")] : []),
    ...(target.save ? [item("save", t("Save"), !writable(), "Mod+S")] : []),
    ...(selection
      ? [{ kind: "sep" } as ContextMenuItem, item("chat", t("Add to chat"), false, "Mod+L")]
      : []),
  ];
  const pick = async (id: string) => {
    if (!target.isCurrent()) return;
    view.focus();
    if (id === "undo" && writable()) sharedUndo(view);
    if (id === "redo" && writable()) sharedRedo(view);
    if (id === "select") selectAll(view);
    if (id === "find") openSearchPanel(view);
    if (id === "format" && writable()) target.format?.();
    if (id === "save" && writable()) target.save?.();
    if (id === "chat" && selection)
      requestAddToChat(formatEditorSelectionReference(selection), "plain");
    if (id === "copy" || id === "cut" || id === "paste") {
      const { doc, selection: ranges } = view.state;
      const stillCurrent = () =>
        writable() && view.state.doc === doc && view.state.selection.eq(ranges);
      try {
        if (id === "paste") {
          const text = await navigator.clipboard.readText();
          if (stillCurrent())
            view.dispatch(view.state.replaceSelection(text), {
              userEvent: "input.paste",
              scrollIntoView: true,
            });
        } else {
          const text = ranges.ranges
            .map((range) => view.state.sliceDoc(range.from, range.to))
            .join(view.state.lineBreak);
          await navigator.clipboard.writeText(text);
          if (id === "cut" && stillCurrent())
            view.dispatch(view.state.replaceSelection(""), {
              userEvent: "delete.cut",
              scrollIntoView: true,
            });
        }
      } catch (error) {
        if (target.isCurrent()) onError(error instanceof Error ? error.message : String(error));
      }
    }
  };
  return (
    <ContextMenu
      x={target.x}
      y={target.y}
      items={items}
      ariaLabel={t("Editor actions")}
      onClose={onClose}
      onPick={(id) => {
        onClose();
        void pick(id);
      }}
    />
  );
}
