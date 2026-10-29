import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useRetainedScroll } from "../../../shared/hooks/useRetainedScroll";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown } from "../../../shared/ui/icons";

/** Each pane owns one scroll area, with its extent visible even on overlay scrollbars. */
export function NoteEditorPane({
  label,
  hidden = false,
  split = false,
  document: readingPane = false,
  scrollKey,
  children,
}: {
  label: string;
  hidden?: boolean;
  /** The visible pane caption is only needed when two panes share the view. */
  split?: boolean;
  /** The rendered document pane uses the ~46rem reading measure on the canvas ground. */
  document?: boolean;
  /** Note/project-scoped window-lifetime position, independent for each pane. */
  scrollKey?: string;
  children: ReactNode;
}) {
  useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const paneId = useId();
  const retainedViewport = useRetainedScroll<HTMLDivElement>(scrollKey ?? `note-pane:${paneId}`, {
    ready: !hidden,
  });
  const setViewport = useCallback((node: HTMLDivElement | null) => {
    viewport.current = node;
    retainedViewport(node);
  }, [retainedViewport]);
  const content = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const node = viewport.current;
    if (!node) return;
    const update = () => setMore(node.scrollHeight - node.clientHeight - node.scrollTop > 2);
    update();
    node.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(node);
    if (content.current) observer?.observe(content.current);
    return () => {
      node.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [hidden, scrollKey]);

  return (
    <div hidden={hidden} data-split={split || undefined} data-document={readingPane || undefined} className={hidden ? "hidden" : "note-editor-pane"}>
      {split ? <div className="note-pane-label">{label}</div> : null}
      <div
        ref={setViewport}
        className="note-pane-scroll"
        role="region"
        aria-label={label}
        tabIndex={0}
      >
        <div ref={content} className="note-pane-content">
          {children}
        </div>
      </div>
      {more ? (
        <div className="note-pane-footer">
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            label={t("More below")}
            onClick={() => {
              const node = viewport.current;
              if (node) node.scrollTop += node.clientHeight * 0.85;
            }}
          >
            <ChevronDown className="icon-xs" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
