import { useEffect, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { requestAddToChat } from "../../sessions/model/quoteDraft";
import type { TranscriptSelection } from "../../sessions/model/transcriptSelection";
import { TranscriptSelectionMenu } from "../../sessions/ui/TranscriptSelectionMenu";
import { createNote, noteTitle } from "../../notes";
import { useSyncExternalStore } from "react";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";

export function TerminalSelectionMenu({
  terminal,
  host,
  active,
  cwd,
}: {
  terminal: Terminal | null;
  host: RefObject<HTMLDivElement | null>;
  active: boolean;
  cwd: string;
}) {
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  useEffect(() => {
    const term = terminal;
    const element = host.current;
    setSelection(null);
    if (!active || !term || !element) return;
    let selecting = false;
    let frame = 0;
    let point: { x: number; y: number } | null = null;
    const report = () => {
      frame = 0;
      if (selecting) return;
      const text = term.getSelection().trim();
      const bounds = element.getBoundingClientRect();
      if (!text || bounds.width <= 0 || bounds.height <= 0) {
        setSelection(null);
        return;
      }
      const position = term.getSelectionPosition();
      const row =
        (position?.start.y ?? term.buffer.active.viewportY) - term.buffer.active.viewportY;
      const rect = new DOMRect(
        point?.x ??
          bounds.left + ((position?.start.x ?? 0) * bounds.width) / Math.max(1, term.cols),
        point?.y ??
          bounds.top +
            (Math.max(0, Math.min(term.rows - 1, row)) * bounds.height) / Math.max(1, term.rows),
        1,
        1,
      );
      setSelection({ text, rect });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(report);
    };
    const down = () => {
      selecting = true;
      cancelAnimationFrame(frame);
      setSelection(null);
    };
    const up = (event: PointerEvent) => {
      if (!selecting) return;
      selecting = false;
      const bounds = element.getBoundingClientRect();
      point = {
        x: Math.max(bounds.left, Math.min(bounds.right, event.clientX)),
        y: Math.max(bounds.top, Math.min(bounds.bottom, event.clientY)),
      };
      schedule();
    };
    const cancel = () => {
      selecting = false;
      cancelAnimationFrame(frame);
      setSelection(null);
    };
    const subscription = term.onSelectionChange(() => {
      point = null;
      schedule();
    });
    const scrollSubscription = term.onScroll(cancel);
    element.addEventListener("pointerdown", down);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    return () => {
      cancelAnimationFrame(frame);
      subscription.dispose();
      scrollSubscription.dispose();
      element.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [active, cwd, terminal, host]);
  return (
    <TranscriptSelectionMenu
      selection={active ? selection : null}
      onDismiss={() => setSelection(null)}
      onAddToChat={(text) => {
        requestAddToChat(text, "quote");
        terminal?.clearSelection();
      }}
      onAddToNotes={
        notesEnabled
          ? async (text) => {
              await createNote({ title: noteTitle(text), body: text, sourceCwd: cwd });
              terminal?.clearSelection();
            }
          : undefined
      }
    />
  );
}
