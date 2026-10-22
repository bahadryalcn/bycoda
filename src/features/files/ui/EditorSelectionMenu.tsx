import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n/technical";
import { useEffect, useRef } from "react";
import { MessageSquarePlus } from "../../../shared/ui/icons";
import { Popover } from "../../../shared/ui/Popover";
import { formatEditorSelectionReference, type EditorCodeSelection } from "../model/editorSelection";
import { requestAddToChat } from "../../sessions/model/quoteDraft";

export type EditorSelectionTarget = EditorCodeSelection & {
  anchor: DOMRect;
};

export function EditorSelectionMenu({
  selection,
  onDismiss,
}: {
  selection: EditorSelectionTarget | null;
  onDismiss: () => void;
}) {
  useLocale();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // A rect captured from CodeMirror is in viewport coordinates. Once the
  // editor moves, dismiss the action instead of leaving it over stale text.
  useEffect(() => {
    if (!selection) return;
    const dismiss = () => onDismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

  if (!selection) return null;
  const shortcut = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘L" : "Ctrl+L";

  return (
    <Popover
      anchor={selection.anchor}
      side="top"
      align="center"
      gap={6}
      onDismiss={onDismiss}
      role="toolbar"
      aria-label={t("Selected code actions")}
      className="p-1"
    >
      <Button
        size="sm"
        variant="ghost"
        motion="none"
        type="button"
        aria-keyshortcuts="Control+l Meta+l"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          requestAddToChat(formatEditorSelectionReference(selection), "plain");
          onDismiss();
        }}
        className="flex items-center gap-1.5 whitespace-nowrap leading-none"
      >
        <MessageSquarePlus aria-hidden="true" className="size-3.5" strokeWidth={1.75} />
        {t("Add to chat")}
        <kbd
          aria-hidden="true"
          className="rounded border border-(--ui-tone-neutral-border) px-1 py-0.5 font-sans text-(length:--ui-font-caption) text-(--ui-text-secondary)"
        >
          {shortcut}
        </kbd>
      </Button>
    </Popover>
  );
}
