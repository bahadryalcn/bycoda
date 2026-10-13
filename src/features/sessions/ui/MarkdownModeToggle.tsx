import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, type ReactNode } from "react";

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
  useLocale();
  return (
    <div
      role="tablist"
      aria-label={t("Markdown view")}
      className="flex rounded-md border border-content/10 bg-content/10 p-0.5 backdrop-blur-md"
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
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`rounded px-2 py-0.5 font-sans text-[11px] ${
        selected ? "bg-selection-strong text-content" : "text-content/45 hover:text-content/80"
      }`}
      onClick={onSelect}
    >
      {label}
    </button>
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
    <div className="markdown-view-shell relative min-h-0 min-w-0 flex-1">
      <div className="markdown-view-actions pointer-events-none absolute right-2 z-20">
        <div className="pointer-events-auto flex items-center gap-1.5">
          {actions}
          <MarkdownModeToggle mode={mode} onChange={onModeChange} />
        </div>
      </div>
      <div
        data-markdown-view-active={mode === "preview" ? "" : undefined}
        className={
          mode === "preview" ? "absolute inset-0" : "pointer-events-none invisible absolute inset-0"
        }
      >
        {preview}
      </div>
      <div
        data-markdown-view-active={mode === "source" ? "" : undefined}
        className={
          mode === "source" ? "absolute inset-0" : "pointer-events-none invisible absolute inset-0"
        }
      >
        {source}
      </div>
    </div>
  );
}
