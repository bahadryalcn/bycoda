import { Button } from "../../../shared/ui/Button";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { FileDiff, LayoutGrid, SplitSquare } from "../../../shared/ui/icons";
import { t, useLocale } from "../../../shared/i18n/git";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import {
  loadDiffLayoutPreference,
  saveDiffLayoutPreference,
  subscribeDiffLayoutPreference,
} from "../model/diffLayout";
import type { DiffLayout } from "../../settings";

/** The diff layout preference, shared by every diff surface. */
export function useDiffLayout(): DiffLayout {
  return useSyncExternalStore(
    subscribeDiffLayoutPreference,
    loadDiffLayoutPreference,
    loadDiffLayoutPreference,
  );
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

/** Compact saved preference; Automatic still follows the actual surface width. */
export function DiffLayoutToggle({ className = "" }: { className?: string }) {
  useLocale();
  const preference = useDiffLayout();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choices = [
    { value: "auto" as const, label: t("Automatic"), Icon: LayoutGrid },
    { value: "inline" as const, label: t("Inline"), Icon: FileDiff },
    { value: "split" as const, label: t("Side-by-side view"), Icon: SplitSquare },
  ];
  const current = choices.find((choice) => choice.value === preference)!;
  const label = `${t("Diff view")}: ${current.label}`;
  const pick = (value: DiffLayout) => {
    // The in-memory preference still applies for this session when storage is unavailable.
    saveDiffLayoutPreference(value);
    setOpen(false);
  };
  return (
    <>
      <Button
        ref={anchor}
        variant="ghost"
        size="sm"
        iconOnly
        label={label}
        motion="none"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            (event.key !== "ArrowDown" && event.key !== "ArrowUp")
          )
            return;
          event.preventDefault();
          setOpen(true);
        }}
        className={`min-w-0 shrink-0 ${className}`}
      >
        <current.Icon className="icon-sm" />
      </Button>
      {open ? (
        <DropdownMenu
          anchor={anchor}
          label={t("Diff view")}
          returnFocusRef={anchor}
          items={choices.map(({ value, label, Icon }) => ({
            kind: "item",
            id: value,
            label,
            icon: <Icon className="icon-sm" />,
            checked: preference === value,
            selectionRole: "radio",
          }))}
          onPick={(id) => {
            if (id === "auto" || id === "inline" || id === "split") pick(id);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
