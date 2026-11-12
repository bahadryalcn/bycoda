import { useLocale, useT } from "../../../shared/i18n";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TabStrip } from "../../../shared/ui/Tabs";
import { Button } from "../../../shared/ui/Button";
import { CodeBlock, Eye, Minus, Plus } from "../../../shared/ui/icons";
import styles from "./MarkdownModeToggle.module.css";

export type MarkdownViewMode = "preview" | "source";

const remembered = new Map<string, MarkdownViewMode>();
const listeners = new Map<string, Set<() => void>>();

/** Select a view before opening a file, or update an already mounted viewer. */
export function setMarkdownViewMode(key: string, mode: MarkdownViewMode) {
  remembered.set(key, mode);
  listeners.get(key)?.forEach((listener) => listener());
}

export function useMarkdownMode(
  key: string,
  fallback: MarkdownViewMode = "preview",
): [MarkdownViewMode, (mode: MarkdownViewMode) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const subscribers = listeners.get(key) ?? new Set();
      subscribers.add(listener);
      listeners.set(key, subscribers);
      return () => {
        subscribers.delete(listener);
        if (subscribers.size === 0) listeners.delete(key);
      };
    },
    [key],
  );
  const mode = useSyncExternalStore(
    subscribe,
    () => remembered.get(key) ?? fallback,
    () => fallback,
  );
  const setMode = useCallback((next: MarkdownViewMode) => setMarkdownViewMode(key, next), [key]);
  return [mode, setMode];
}

type ToggleProps = {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
};

export function MarkdownModeToggle({ mode, onChange }: ToggleProps) {
  const t = useT();
  return (
    <TabStrip
      label={t("Markdown view")}
      className="shrink-0"
      value={mode}
      items={[
        {
          value: "preview",
          label: t("Preview"),
          icon: <Eye className="icon-sm" />,
          iconOnly: true,
        },
        {
          value: "source",
          label: t("Source"),
          icon: <CodeBlock className="icon-sm" />,
          iconOnly: true,
        },
      ]}
      onValueChange={(next) => onChange(next as MarkdownViewMode)}
    />
  );
}

type ShellProps = {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  preview: ReactNode;
  source: ReactNode;
  /** Controls placed before the Preview/Source switch, on the right of the row. */
  actions?: ReactNode;
  /** Optional start-aligned content (for example Save and status) sharing the same row. */
  leading?: ReactNode;
  /** Markdown preview content only; source editors own their existing code zoom. */
  zoomable?: boolean;
};

export function MarkdownViewShell({
  mode,
  onModeChange,
  preview,
  source,
  actions,
  leading,
  zoomable = true,
}: ShellProps) {
  useLocale();
  const t = useT();
  const [zoom, setZoom] = useState(100);
  const content = useRef<HTMLDivElement>(null);
  const changeZoom = useCallback((step: number) => {
    setZoom((value) => Math.max(50, Math.min(200, value + step)));
  }, []);
  useEffect(() => {
    const node = content.current;
    if (!node || !zoomable || mode !== "preview") return;
    const onWheel = (event: WheelEvent) => {
      if (event.defaultPrevented || !event.ctrlKey || event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      changeZoom(event.deltaY < 0 ? 10 : -10);
    };
    node.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => node.removeEventListener("wheel", onWheel, { capture: true });
  }, [zoomable, mode, changeZoom]);
  return (
    <div className="markdown-view-shell flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="markdown-view-actions flex shrink-0 items-center gap-2 px-2 py-1">
        {leading ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{leading}</div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center justify-end gap-1">
          {actions}
          {zoomable && mode === "preview" ? (
            <div className="flex shrink-0 items-center gap-0.5">
              <Button
                iconOnly
                label={t("Zoom out")}
                variant="ghost"
                size="sm"
                disabled={zoom === 50}
                onClick={() => changeZoom(-10)}
              >
                <Minus className="icon-sm" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                tooltip={t("Reset zoom")}
                aria-label={t("Reset zoom")}
                className="tabular-nums"
                onClick={() => setZoom(100)}
              >
                {zoom}%
              </Button>
              <Button
                iconOnly
                label={t("Zoom in")}
                variant="ghost"
                size="sm"
                disabled={zoom === 200}
                onClick={() => changeZoom(10)}
              >
                <Plus className="icon-sm" />
              </Button>
            </div>
          ) : null}
          <MarkdownModeToggle mode={mode} onChange={onModeChange} />
        </div>
      </div>
      <div
        ref={content}
        className={`${styles.content} relative min-h-0 min-w-0 flex-1`}
        style={{ "--markdown-document-zoom": zoomable ? zoom / 100 : 1 } as CSSProperties}
      >
        <MarkdownViewPane name="preview" active={mode === "preview"}>
          {preview}
        </MarkdownViewPane>
        <MarkdownViewPane name="source" active={mode === "source"}>
          {source}
        </MarkdownViewPane>
      </div>
    </div>
  );
}

/**
 * The inactive pane stays mounted (drafts, undo, selection, scroll and editor
 * measurement carry over) but cannot paint or take input. Descendants such as the
 * editor overview ruler force `visibility: visible` and `pointer-events: auto`, so
 * inherited visibility alone is not enough: `inert` removes the subtree from
 * focus, hit testing and the accessibility tree, and the inline opacity hides
 * anything a descendant's own rules would still paint.
 */
export function MarkdownViewPane({
  name,
  active,
  children,
}: {
  name: MarkdownViewMode;
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-markdown-view-pane={name}
      data-markdown-view-active={active ? "" : undefined}
      inert={!active}
      aria-hidden={active ? undefined : true}
      className={active ? "absolute inset-0" : "pointer-events-none invisible absolute inset-0"}
      style={active ? undefined : { opacity: 0 }}
    >
      {children}
    </div>
  );
}
