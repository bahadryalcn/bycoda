import { useLayoutEffect, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Terminal } from "@xterm/xterm";
import styles from "./TerminalTools.module.css";

/** Presentation only: never writes to the terminal buffer, selection or clipboard. */
export function TerminalGhostText({ terminal, suffix }: { terminal: Terminal; suffix: string }) {
  const [layout, setLayout] = useState<{ screen: Element; style: CSSProperties }>();
  useLayoutEffect(() => {
    const screen = terminal.element?.querySelector(".xterm-screen");
    if (!screen) return;
    const update = () => {
      const buffer = terminal.buffer.active;
      const row = buffer.baseY + buffer.cursorY - buffer.viewportY;
      if (buffer.type !== "normal" || row < 0 || row >= terminal.rows || terminal.hasSelection()) {
        setLayout(undefined);
        return;
      }
      const cellWidth = screen.clientWidth / terminal.cols;
      const cellHeight = screen.clientHeight / terminal.rows;
      setLayout({
        screen,
        style: {
          insetInlineStart: buffer.cursorX * cellWidth,
          insetBlockStart: row * cellHeight,
          inlineSize: Math.max(0, (terminal.cols - buffer.cursorX) * cellWidth),
          blockSize: cellHeight,
          lineHeight: `${cellHeight}px`,
          fontFamily: terminal.options.fontFamily,
          fontSize: terminal.options.fontSize,
          fontWeight: terminal.options.fontWeight,
          letterSpacing: terminal.options.letterSpacing,
        },
      });
    };
    update();
    const subscriptions = [
      terminal.onRender(update),
      terminal.onResize(update),
      terminal.onScroll(update),
      terminal.onSelectionChange(update),
    ];
    const observer = new ResizeObserver(update);
    observer.observe(screen);
    return () => {
      subscriptions.forEach((s) => s.dispose());
      observer.disconnect();
    };
  }, [terminal]);
  if (!layout) return null;
  return createPortal(
    <span aria-hidden="true" className={styles.ghost} style={layout.style}>
      {suffix}
    </span>,
    layout.screen,
  );
}
