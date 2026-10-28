import { useLocale, useT } from "../../../shared/i18n";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../../shared/ui/Button";

export type MarkdownViewMode = "preview" | "source";

const remembered = new Map<string, MarkdownViewMode>();
const listeners = new Map<string, Set<(mode: MarkdownViewMode) => void>>();

/** Select a view before opening a file, or update an already mounted viewer. */
export function setMarkdownViewMode(key: string, mode: MarkdownViewMode) {
  remembered.set(key, mode);
  listeners.get(key)?.forEach((listener) => listener(mode));
}

export function useMarkdownMode(
  key: string,
  fallback: MarkdownViewMode = "preview",
): [MarkdownViewMode, (mode: MarkdownViewMode) => void] {
  const [mode, setMode] = useState<MarkdownViewMode>(() => remembered.get(key) ?? fallback);

  useEffect(() => {
    setMode(remembered.get(key) ?? fallback);
    const subscribers = listeners.get(key) ?? new Set();
    subscribers.add(setMode);
    listeners.set(key, subscribers);
    return () => {
      subscribers.delete(setMode);
      if (subscribers.size === 0) listeners.delete(key);
    };
  }, [key, fallback]);

  return [
    mode,
    (next) => {
      setMarkdownViewMode(key, next);
    },
  ];
}

type ToggleProps = {
  mode: MarkdownViewMode;
  onChange: (mode: MarkdownViewMode) => void;
};

export function MarkdownModeToggle({ mode, onChange }: ToggleProps) {
  const t = useT();
  return (
    <div
      role="tablist"
      aria-label={t("Markdown view")}
      className="flex shrink-0 rounded-md border border-(--ui-tone-neutral-border) bg-[var(--ui-surface)] p-0.5"
    >
      <ModeTab
        label={t("Preview")}
        selected={mode === "preview"}
        onSelect={() => onChange("preview")}
      />
      <ModeTab
        label={t("Source")}
        selected={mode === "source"}
        onSelect={() => onChange("source")}
      />
    </div>
  );
}

function ModeTab({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  useLocale();
  return (
    <Button variant="tab" role="tab" aria-selected={selected} onClick={onSelect}>
      {label}
    </Button>
  );
}

type ShellProps = {
  mode: MarkdownViewMode;
  onModeChange: (mode: MarkdownViewMode) => void;
  preview: ReactNode;
  source: ReactNode;
  actions?: ReactNode;
};

export function MarkdownViewShell({ mode, onModeChange, preview, source, actions }: ShellProps) {
  useLocale();
  return (
    <div className="markdown-view-shell flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="markdown-view-actions flex shrink-0 justify-end border-b border-(--ui-tone-neutral-border) px-2 py-1">
        <div className="flex flex-wrap items-center justify-end gap-1.5">
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
