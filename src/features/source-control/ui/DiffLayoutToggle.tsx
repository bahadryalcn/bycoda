import { Select } from "../../../shared/ui/Select";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import {
  loadDiffLayout,
  saveDiffLayout,
  subscribeDiffLayout,
  type DiffLayout,
} from "../../settings/model/settings";

/** The diff layout preference, shared by every diff surface. */
export function useDiffLayout(): DiffLayout {
  return useSyncExternalStore(subscribeDiffLayout, loadDiffLayout, loadDiffLayout);
}

export const DIFF_INLINE_BREAKPOINT = 900;

/** Automatic follows the editor's available width, without changing the saved choice. */
export function useResponsiveDiffLayout(
  surface: RefObject<HTMLElement | null>,
  mounted = true,
): "inline" | "split" {
  const preference = useDiffLayout();
  const [automatic, setAutomatic] = useState<"inline" | "split">("inline");
  useEffect(() => {
    const element = surface.current;
    if (!mounted || !element || preference !== "auto") return;
    const update = (width: number) => {
      // Hidden tabs keep their current editor and drafts until shown again.
      if (width > 0) setAutomatic(width < DIFF_INLINE_BREAKPOINT ? "inline" : "split");
    };
    update(element.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) update(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [mounted, preference, surface]);
  return preference === "auto" ? automatic : preference;
}

/** Three stable layout choices use the shared keyboard-accessible Select. */
export function DiffLayoutToggle({ className = "" }: { className?: string }) {
  useLocale();
  const preference = useDiffLayout();
  return (
    <Select
      label={t("Diff view")}
      value={preference}
      options={[
        { value: "auto", label: t("Automatic") },
        { value: "inline", label: t("Inline") },
        { value: "split", label: t("Side-by-side view") },
      ]}
      onValueChange={(value) => saveDiffLayout(value as DiffLayout)}
      className={`min-w-0 shrink-0 ${className}`}
    />
  );
}
