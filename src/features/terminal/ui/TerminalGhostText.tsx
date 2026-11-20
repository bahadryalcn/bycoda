import { useLayoutEffect, useState, type CSSProperties } from "react";
import type { Terminal } from "@xterm/xterm";
import { observeResize } from "../../../shared/lib/observeResize";
import { Portal } from "../../../shared/ui/Portal";
import { coalescedFrame } from "../runtime/coalescedFrame";
import styles from "./TerminalTools.module.css";

function sameStyle(a: CSSProperties, b: CSSProperties) {
  const keys = Object.keys(b) as (keyof CSSProperties)[];
  return keys.every((key) => a[key] === b[key]);
}

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
      const style: CSSProperties = {
        insetInlineStart: buffer.cursorX * cellWidth,
        insetBlockStart: row * cellHeight,
        inlineSize: Math.max(0, (terminal.cols - buffer.cursorX) * cellWidth),
        blockSize: cellHeight,
        lineHeight: `${cellHeight}px`,
        fontFamily: terminal.options.fontFamily,
        fontSize: terminal.options.fontSize,
        fontWeight: terminal.options.fontWeight,
        letterSpacing: terminal.options.letterSpacing,
      };
      // Keep the previous object when nothing moved, so streaming output does not re-render.
      setLayout((previous) =>
        previous && previous.screen === screen && sameStyle(previous.style, style)
          ? previous
          : { screen, style },
      );
    };
    update();
    // Event bursts are measured once per frame, from the buffer as it is when the frame fires.
    const frame = coalescedFrame(update);
    const subscriptions = [
      terminal.onRender(frame.schedule),
      terminal.onResize(frame.schedule),
      terminal.onScroll(frame.schedule),
      terminal.onSelectionChange(frame.schedule),
    ];
    const stopObserving = observeResize(screen, frame.schedule);
    return () => {
      frame.cancel();
      subscriptions.forEach((s) => s.dispose());
      stopObserving();
    };
  }, [terminal]);
  if (!layout) return null;
  // Justified portal: the ghost suggestion must sit inside xterm's own screen element so it
  // shares the terminal's scroll, clipping and cell-grid coordinates. It is not an overlay,
  // so the shared Popover/overlay stack does not apply.
  return (
    <Portal target={layout.screen}>
      <span aria-hidden="true" className={styles.ghost} style={layout.style}>
        {suffix}
      </span>
    </Portal>
  );
}
