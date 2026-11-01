import { useLocale, useT } from "../../../shared/i18n";
import { useCallback, useSyncExternalStore, type ReactNode } from "react";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";

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
    <SegmentedControl
      label={t("Markdown view")}
      className="shrink-0"
      value={mode}
      options={[
        { value: "preview", label: t("Preview") },
        { value: "source", label: t("Source") },
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
};

export function MarkdownViewShell({
  mode,
  onModeChange,
  preview,
  source,
  actions,
  leading,
}: ShellProps) {
  useLocale();
  return (
    <div className="markdown-view-shell flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="markdown-view-actions flex shrink-0 items-center gap-2 px-2 py-1">
        {leading ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">{leading}</div>
        ) : null}
        <div className="ms-auto flex flex-wrap items-center justify-end gap-1">
          {actions}
          <MarkdownModeToggle mode={mode} onChange={onModeChange} />
        </div>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
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
