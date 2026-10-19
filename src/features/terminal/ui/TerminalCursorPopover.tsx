import { useLayoutEffect, useState, type ReactNode } from "react";
import type { Terminal } from "@xterm/xterm";
import { Popover } from "../../../shared/ui/Popover";

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
      setAnchor(
        new DOMRect(
          rect.left + (buffer.cursorX * rect.width) / terminal.cols,
          rect.top + (row * rect.height) / terminal.rows,
          rect.width / terminal.cols,
          rect.height / terminal.rows,
        ),
      );
    };
    update();
    const subscriptions = [
      terminal.onRender(update),
      terminal.onResize(update),
      terminal.onScroll(update),
    ];
    const observer = new ResizeObserver(update);
    observer.observe(screen);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      subscriptions.forEach((subscription) => subscription.dispose());
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [terminal]);
  if (!anchor) return null;
  return (
    <Popover
      anchor={anchor}
      width={360}
      maxHeight={220}
      autoFocus={false}
      onDismiss={onDismiss}
      ignore=".xterm"
      dismissOnEscape={false}
    >
      {children}
    </Popover>
  );
}
