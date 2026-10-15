import { t, useLocale } from "../../../shared/i18n/git";
import { useSyncExternalStore } from "react";
import { SplitSquare } from "../../../shared/ui/icons";
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

/** Flips every diff between one column and before | after. */
export function DiffLayoutToggle({ className = "" }: { className?: string }) {
  useLocale();
  const split = useDiffLayout() === "split";
  return (
    <button
      type="button"
      title={t("Side-by-side view")}
      aria-label={t("Side-by-side view")}
      aria-pressed={split}
      // Keep the caret where it is when this sits next to an editor.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => saveDiffLayout(split ? "inline" : "split")}
      className={`grid size-6 place-items-center rounded hover:bg-content/10 hover:text-content ${
        split ? "bg-content/10 text-content" : "text-content/70"
      } ${className}`}
    >
      <SplitSquare className="size-3.5" strokeWidth={1.75} />
    </button>
  );
}
