import type { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../../../shared/i18n/technical";
import { observeResize } from "../../../shared/lib/observeResize";
import { Sash } from "../../../shared/ui/Sash";
import { Portal } from "../../../shared/ui/Portal";
import styles from "./EditorBlameResize.module.css";

const DEFAULT_WIDTH = 182;
const MIN_WIDTH = 48;

/** Keep the handle outside CodeMirror's aria-hidden gutters and scrolling document. */
export function EditorBlameResize({
  view,
  enabled,
}: {
  view: EditorView | null;
  enabled: boolean;
}) {
  const t = useT();
  const [preferred, setPreferred] = useState(DEFAULT_WIDTH);
  const [layout, setLayout] = useState({ max: 400, left: 0, top: 0, bottom: 0 });
  const start = useRef(DEFAULT_WIDTH);
  const width = Math.min(preferred, layout.max);
  const min = Math.min(MIN_WIDTH, layout.max);
  const clamp = (value: number) => Math.max(min, Math.min(layout.max, Math.round(value)));

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Observe CodeMirror's viewport to align the divider and bound its width, including split diffs and search panels.
  useLayoutEffect(() => {
    if (!view) return;
    const measure = () => {
      const editor = view.dom.getBoundingClientRect();
      const scroller = view.scrollDOM.getBoundingClientRect();
      const gutter = view.dom.querySelector(".cm-blameGutter")?.getBoundingClientRect();
      if (!editor.width) return;
      setLayout({
        max: Math.max(0, Math.min(400, Math.floor(scroller.width * 0.45))),
        left: gutter ? gutter.left - editor.left : 0,
        top: scroller.top - editor.top,
        bottom: editor.bottom - scroller.bottom,
      });
    };
    measure();
    // Reconfiguration adds the gutter in the parent's passive effect, after this layout effect.
    const frame = requestAnimationFrame(measure);
    const unobserve = observeResize(view.scrollDOM, measure);
    return () => {
      cancelAnimationFrame(frame);
      unobserve();
    };
  }, [view, enabled]);

  // oxlint-disable-next-line bycoda/effect-names-its-sync -- Sync the gutter DOM width and CodeMirror's wrapped-line measurements without rebuilding editor state.
  useLayoutEffect(() => {
    if (!view) return;
    view.dom.style.setProperty("--editor-blame-width", `${width}px`);
    view.requestMeasure();
    return () => {
      view.dom.style.removeProperty("--editor-blame-width");
    };
  }, [view, width]);

  if (!view || !enabled) return null;
  return (
    <Portal target={view.dom}>
      <Sash
        orientation="vertical"
        label={t("Blame")}
        value={width}
        min={min}
        max={layout.max}
        className={styles.handle}
        style={
          {
            "--blame-resize-left": `${layout.left + width}px`,
            "--blame-resize-top": `${layout.top}px`,
            "--blame-resize-bottom": `${layout.bottom}px`,
          } as CSSProperties
        }
        onResizeStart={() => (start.current = width)}
        onResize={(delta) => setPreferred(clamp(start.current + delta))}
        onResizeEnd={(_delta, { cancelled }) => {
          if (cancelled) setPreferred(start.current);
        }}
        onReset={() => setPreferred(DEFAULT_WIDTH)}
      />
    </Portal>
  );
}
