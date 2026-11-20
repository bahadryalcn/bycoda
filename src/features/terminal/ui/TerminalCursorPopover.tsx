/** Different job: Cursor-anchored terminal overlay preserves terminal input and delegates its frame to Popover. */
import { useLayoutEffect, useState, type ReactNode } from "react";
import type { Terminal } from "@xterm/xterm";
import { observeResize } from "../../../shared/lib/observeResize";
import { Popover } from "../../../shared/ui/Popover";
import { localTerminalPrefix } from "../model/localTerminalCompletion";
import { coalescedFrame } from "../runtime/coalescedFrame";

/** Use the public buffer and rendered screen bounds; never xterm internals. */
export function TerminalCursorPopover({
  terminal,
  onDismiss,
  children,
}: {
  terminal: Terminal;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const [anchor, setAnchor] = useState<DOMRect>();
  useLayoutEffect(() => {
    const screen = terminal.element?.querySelector(".xterm-screen");
    if (!screen) return;
    const update = () => {
      const rect = screen.getBoundingClientRect();
      const buffer = terminal.buffer.active;
      const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
      if (row < 0 || row >= terminal.rows) {
        setAnchor(undefined);
        return;
      }
      // Anchor at the start of the typed command, read from the same buffer
      // state as the cursor, so the popover stays put while its list updates.
      const column = Math.max(0, buffer.cursorX - (localTerminalPrefix(terminal)?.length ?? 0));
      const next = new DOMRect(
        rect.left + (column * rect.width) / terminal.cols,
        rect.top + (row * rect.height) / terminal.rows,
        rect.width / terminal.cols,
        rect.height / terminal.rows,
      );
      setAnchor((previous) =>
        previous &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    update();
    // Event bursts are measured once per frame, from the buffer as it is when the frame fires.
    const frame = coalescedFrame(update);
    // Only a scroll of the screen or one of its ancestors moves the anchor; other scrollers
    // anywhere in the app are ignored.
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && event.target.contains(screen)) frame.schedule();
    };
    const subscriptions = [
      terminal.onRender(frame.schedule),
      terminal.onResize(frame.schedule),
      terminal.onScroll(frame.schedule),
    ];
    const stopObserving = observeResize(screen, frame.schedule);
    window.addEventListener("resize", frame.schedule);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      frame.cancel();
      subscriptions.forEach((subscription) => subscription.dispose());
      stopObserving();
      window.removeEventListener("resize", frame.schedule);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [terminal]);
  if (!anchor) return null;
  return (
    <Popover
      anchor={anchor}
      width={360}
      maxHeight={220}
      autoFocus={false}
      solid
      onDismiss={onDismiss}
      ignore=".xterm"
      dismissOnEscape={false}
    >
      {children}
    </Popover>
  );
}
