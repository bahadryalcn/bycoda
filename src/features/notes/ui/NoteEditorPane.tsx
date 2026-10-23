import { useEffect, useRef, useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ChevronDown } from "../../../shared/ui/icons";

/** Each pane owns one scroll area, with its extent visible even on overlay scrollbars. */
export function NoteEditorPane({
  label,
  hidden = false,
  split = false,
  children,
}: {
  label: string;
  hidden?: boolean;
  /** The visible pane caption is only needed when two panes share the view. */
  split?: boolean;
  children: ReactNode;
}) {
  useLocale();
  const viewport = useRef<HTMLDivElement>(null);
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
  }, []);

  return (
    <div hidden={hidden} className={hidden ? "hidden" : "note-editor-pane"}>
      {split ? <div className="note-pane-label">{label}</div> : null}
      <div
        ref={viewport}
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
            onClick={() => {
              const node = viewport.current;
              if (node) node.scrollTop += node.clientHeight * 0.85;
            }}
          >
            <ChevronDown className="icon-xs" />
            {t("More below")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
